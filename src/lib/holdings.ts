// Wallet holdings: every fungible Token/Token-2022 position Par recognizes, with live mint state.
//
// Helius DAS getAssetsByOwner is the wallet-discovery source (which mints, raw balance, decimals,
// and the on-chain metadata used to label mints we do not list). It is NOT used for the Token-2022
// extension config: a live probe on 2026-09-19 (PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF and
// XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp) showed DAS mint_extensions omitting scaled_ui_amount_config
// and pausable_config entirely, and returning a stale transfer_fee_config (0 bps where the mint account
// itself carries 50 bps at the current epoch). getAccountInfo(jsonParsed) on the same mints was complete
// and matched the registry's known multiplier and fee, so MintState is built from that instead. See
// scripts/verify-holdings.mjs for the head-to-head.

import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { Holding, Issuer, MintState, Wrapper } from "./types";
import { wrapperByMint, issuerUpdateAuthorities, issuerMintPrefixes } from "./registry";
import { effectiveMultiplier, rawToUnits } from "./units";

const TOKEN_PROGRAM = TOKEN_PROGRAM_ID.toBase58();
const TOKEN_2022_PROGRAM = TOKEN_2022_PROGRAM_ID.toBase58();

function rpcUrl(): string {
  const url = process.env.NEXT_PUBLIC_RPC_URL;
  if (!url) throw new Error("NEXT_PUBLIC_RPC_URL is not set");
  return url;
}

/** Generic Helius RPC POST. Exported so the verify script can probe the same endpoint independently. */
export async function heliusRpc<T = unknown>(method: string, params: unknown): Promise<T> {
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "par-holdings", method, params }),
    // Short revalidate window: dedupes rapid repeat requests for the same owner/method within a few
    // seconds without meaningfully staling a balance. No in-memory last-good fallback on failure here
    // (unlike xstocksNextEvent below): a wrong stale holdings list is worse than a 502, since a user
    // acts on what they see as their current, tradeable balance.
    next: { revalidate: 5 },
  });
  if (!res.ok) throw new Error(`Helius RPC ${method} failed: HTTP ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(`Helius RPC ${method} error: ${json.error.message ?? JSON.stringify(json.error)}`);
  return json.result as T;
}

interface DasMetadata {
  name?: string;
  symbol?: string;
  update_authority?: string;
}

interface DasFungibleItem {
  interface: string;
  id: string;
  content?: { metadata?: DasMetadata };
  mint_extensions?: { metadata?: DasMetadata };
  token_info?: { balance?: number | string; decimals?: number; token_program?: string };
}

interface ParsedExtension {
  extension: string;
  state: Record<string, unknown>;
}

interface ParsedMintInfo {
  decimals: number;
  supply: string;
  freezeAuthority?: string | null;
  extensions?: ParsedExtension[];
}

interface RpcAccountValue {
  owner: string;
  data: { parsed?: { info?: ParsedMintInfo } };
}

/** Build MintState from getAccountInfo(jsonParsed), the authoritative source (see file header). */
function parseMintState(mint: string, owner: string, info: ParsedMintInfo, currentEpoch: number, fetchedAt: number): MintState {
  const program = owner === TOKEN_2022_PROGRAM ? "token-2022" : "token";
  const byType = new Map((info.extensions ?? []).map((e) => [e.extension, e.state]));

  const scaled = byType.get("scaledUiAmountConfig") as { multiplier?: string; newMultiplier?: string; newMultiplierEffectiveTimestamp?: number } | undefined;
  let multiplier = 1;
  let multiplierChangesAt: number | undefined;
  let pendingMultiplier: number | undefined;
  if (scaled) {
    const m = Number(scaled.multiplier ?? "1");
    const nm = Number(scaled.newMultiplier ?? "1");
    const ts = Number(scaled.newMultiplierEffectiveTimestamp ?? 0);
    multiplier = effectiveMultiplier({ multiplier: m, newMultiplier: nm, newMultiplierEffectiveTimestamp: ts });
    if (ts > 0 && ts > Math.floor(Date.now() / 1000)) {
      multiplierChangesAt = ts;
      pendingMultiplier = nm;
    }
  }

  const feeCfg = byType.get("transferFeeConfig") as
    | { newerTransferFee?: { epoch: number; transferFeeBasisPoints: number }; olderTransferFee?: { epoch: number; transferFeeBasisPoints: number } }
    | undefined;
  let transferFeeBps = 0;
  if (feeCfg) {
    const newer = feeCfg.newerTransferFee;
    const older = feeCfg.olderTransferFee;
    transferFeeBps = newer && currentEpoch >= Number(newer.epoch) ? Number(newer.transferFeeBasisPoints) : Number(older?.transferFeeBasisPoints ?? 0);
  }

  const permanentDelegate = byType.get("permanentDelegate") as { delegate?: string } | undefined;
  const pausable = byType.get("pausableConfig") as { paused?: boolean } | undefined;
  const hook = byType.get("transferHook") as { authority?: string; programId?: string | null } | undefined;
  const defaultState = byType.get("defaultAccountState") as { accountState?: string } | undefined;

  return {
    mint,
    program,
    decimals: info.decimals,
    supplyRaw: info.supply,
    multiplier,
    multiplierChangesAt,
    pendingMultiplier,
    transferFeeBps,
    permanentDelegate: permanentDelegate?.delegate,
    freezeAuthority: info.freezeAuthority ?? undefined,
    paused: pausable?.paused ?? false,
    pausable: !!pausable,
    transferHookProgram: hook ? hook.programId ?? null : undefined,
    transferHookAuthority: hook?.authority,
    defaultAccountFrozen: defaultState?.accountState === "frozen",
    fetchedAt,
  };
}

async function fetchMintStates(mints: string[], currentEpoch: number): Promise<Map<string, MintState>> {
  const out = new Map<string, MintState>();
  const fetchedAt = Math.floor(Date.now() / 1000);
  for (let i = 0; i < mints.length; i += 100) {
    const chunk = mints.slice(i, i + 100);
    const { value: values } = await heliusRpc<{ value: (RpcAccountValue | null)[] }>("getMultipleAccounts", [chunk, { encoding: "jsonParsed" }]);
    values.forEach((value, idx) => {
      const info = value?.data?.parsed?.info;
      if (!value || !info) return;
      out.set(chunk[idx], parseMintState(chunk[idx], value.owner, info, currentEpoch, fetchedAt));
    });
  }
  return out;
}

/** Label a mint we do not carry in the registry from its on-chain metadata, per the issuer heuristics. */
function identifyUnknownWrapper(mint: string, item: DasFungibleItem, decimals: number): Wrapper | null {
  const meta = item.content?.metadata ?? item.mint_extensions?.metadata;
  const updateAuthority = item.mint_extensions?.metadata?.update_authority;
  const name = meta?.name;
  const symbol = meta?.symbol ?? mint.slice(0, 6);

  let issuer: Issuer | undefined = updateAuthority ? issuerUpdateAuthorities[updateAuthority] : undefined;
  if (!issuer) {
    const prefixed = issuerMintPrefixes.find((p) => mint.startsWith(p.prefix));
    if (prefixed) issuer = prefixed.issuer;
    else if (name?.endsWith("- Backpack Securities")) issuer = "backpack";
  }
  if (!issuer) return null;

  const reference: Wrapper["reference"] =
    issuer === "backpack" ? { kind: "backpack-external", symbol: `${symbol}_USDC` } : issuer === "prestocks" ? { kind: "prestocks", symbol } : { kind: "xstocks-price-data", symbol };

  return { mint, issuer, symbol, name: name ?? symbol, decimals, companyId: "", reference };
}

function formatPowers(state: MintState): string {
  const feePct = (state.transferFeeBps / 100).toString();
  const hook = state.transferHookProgram ? state.transferHookProgram : "none";
  return (
    `freeze: ${state.freezeAuthority ? "yes" : "no"} · ` +
    `permanent delegate: ${state.permanentDelegate ? "yes" : "no"} · ` +
    `paused: ${state.paused ? "yes" : "no"} · ` +
    `transfer hook: ${hook} · ` +
    `transfer fee ${feePct}%`
  );
}

// In-memory last-good cache for the xStocks corporate-actions feed (1 h data, kept beyond that on failure).
const corporateActionsLastGood = new Map<string, { json: { nodes?: XstocksCorporateAction[] }; fetchedAt: number }>();

interface XstocksCorporateAction {
  caType: string;
  effectiveTimeUtc: string;
  grossCashflowUsd?: string | null;
  multiplierNew?: string | null;
}

function pickUpcomingAction(nodes: XstocksCorporateAction[], nowSec: number): Holding["nextEvent"] {
  const future = nodes
    .map((n) => ({ n, atSec: Math.floor(new Date(n.effectiveTimeUtc).getTime() / 1000) }))
    .filter(({ atSec }) => Number.isFinite(atSec) && atSec > nowSec)
    .sort((a, b) => a.atSec - b.atSec);
  const next = future[0];
  if (!next) return undefined;
  const { n, atSec } = next;
  const date = n.effectiveTimeUtc.slice(0, 10);
  const text = n.multiplierNew
    ? `${n.caType}: multiplier to ${n.multiplierNew} on ${date}`
    : n.grossCashflowUsd
      ? `${n.caType}: $${n.grossCashflowUsd} gross on ${date}`
      : `${n.caType} on ${date}`;
  return { at: atSec, text, sourceUrl: "https://docs.xstocks.fi/docs/dividends-and-stock-splits" };
}

// Deliberate deviation from the reference-caching rule ("three failures serve last-good for 60s"):
// nextEvent is an optional display string, not a Reference (see types.ts -- Holding.nextEvent carries
// no asOf/ageSec/stale slot to report a fallback against). On any single failure this serves the last
// successful corporate-actions payload with no expiry, since a missed or stale "next event" line is a
// minor cosmetic gap, not a number a user could act on wrongly.
async function xstocksNextEvent(symbol: string): Promise<Holding["nextEvent"]> {
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(`https://api.xstocks.fi/api/v2/public/corporate-actions/upcoming?symbol=${encodeURIComponent(symbol)}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`xstocks corporate-actions HTTP ${res.status}`);
    const json = (await res.json()) as { nodes?: XstocksCorporateAction[] };
    corporateActionsLastGood.set(symbol, { json, fetchedAt: Date.now() });
    return pickUpcomingAction(json.nodes ?? [], nowSec);
  } catch {
    const cached = corporateActionsLastGood.get(symbol);
    return cached ? pickUpcomingAction(cached.json.nodes ?? [], nowSec) : undefined;
  }
}

function backpackNextEvent(state: MintState): Holding["nextEvent"] {
  if (!state.multiplierChangesAt || state.pendingMultiplier === undefined) return undefined;
  const date = new Date(state.multiplierChangesAt * 1000).toISOString().slice(0, 10);
  return { at: state.multiplierChangesAt, text: `Multiplier changes to ${state.pendingMultiplier} on ${date}` };
}

async function resolveNextEvent(wrapper: Wrapper, state: MintState): Promise<Holding["nextEvent"]> {
  switch (wrapper.issuer) {
    case "xstocks":
      return xstocksNextEvent(wrapper.symbol);
    case "backpack":
      return backpackNextEvent(state);
    case "tessera":
    case "prestocks":
      return { text: "none announced" };
    default:
      return undefined;
  }
}

/**
 * Every fungible Token/Token-2022 position a wallet holds that Par recognizes: registry wrappers by
 * mint, plus unlisted mints labeled by update authority, "Pre" prefix, or issuer metadata suffix.
 * Mints matching none of those are skipped.
 */
export async function getHoldings(owner: string): Promise<Holding[]> {
  let ownerKey: PublicKey;
  try {
    ownerKey = new PublicKey(owner);
  } catch {
    throw new Error("invalid owner address");
  }

  const [assets, epochInfo] = await Promise.all([
    heliusRpc<{ items: DasFungibleItem[] }>("getAssetsByOwner", {
      ownerAddress: ownerKey.toBase58(),
      page: 1,
      limit: 1000,
      displayOptions: { showFungible: true, showZeroBalance: false },
    }),
    heliusRpc<{ epoch: number }>("getEpochInfo", []),
  ]);

  const items = (assets.items ?? []).filter(
    (it): it is DasFungibleItem & { token_info: Required<Pick<DasFungibleItem, "token_info">>["token_info"] } =>
      (it.interface === "FungibleToken" || it.interface === "FungibleAsset") &&
      it.token_info?.balance != null &&
      it.token_info?.decimals != null &&
      (it.token_info.token_program === TOKEN_PROGRAM || it.token_info.token_program === TOKEN_2022_PROGRAM),
  );
  if (items.length === 0) return [];

  const mintStates = await fetchMintStates(
    items.map((i) => i.id),
    epochInfo.epoch,
  );

  const staged: { mint: string; wrapper: Wrapper; balanceRaw: string; balanceUnits: number; state: MintState }[] = [];
  for (const item of items) {
    const state = mintStates.get(item.id);
    if (!state) continue; // mint account vanished between the two calls; nothing reliable to show
    const wrapper = wrapperByMint.get(item.id) ?? identifyUnknownWrapper(item.id, item, item.token_info.decimals!);
    if (!wrapper) continue; // matches no known issuer; skip per spec

    const balanceRaw = String(item.token_info.balance);
    const balanceUnits = rawToUnits(balanceRaw, item.token_info.decimals!, state.multiplier);
    staged.push({ mint: item.id, wrapper, balanceRaw, balanceUnits, state });
  }

  const nextEvents = await Promise.all(staged.map((h) => resolveNextEvent(h.wrapper, h.state)));

  return staged.map((h, i) => ({
    mint: h.mint,
    wrapper: h.wrapper,
    balanceRaw: h.balanceRaw,
    balanceUnits: h.balanceUnits,
    state: h.state,
    powers: formatPowers(h.state),
    nextEvent: nextEvents[i],
  }));
}

/**
 * Cross-check: getTokenAccountsByOwner(jsonParsed) already applies the scaled-UI multiplier server-side.
 * Used by scripts/verify-holdings.mjs to confirm getHoldings' own raw x multiplier math agrees with it.
 */
export async function crossCheckOwnerBalances(owner: string): Promise<{ mint: string; amountRaw: string; uiAmount: number }[]> {
  const ownerKey = new PublicKey(owner);
  const out: { mint: string; amountRaw: string; uiAmount: number }[] = [];
  for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    const res = await heliusRpc<{ value: { account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string; uiAmount: number } } } } } }[] }>(
      "getTokenAccountsByOwner",
      [ownerKey.toBase58(), { programId }, { encoding: "jsonParsed" }],
    );
    for (const { account } of res.value ?? []) {
      const info = account.data.parsed.info;
      out.push({ mint: info.mint, amountRaw: info.tokenAmount.amount, uiAmount: info.tokenAmount.uiAmount });
    }
  }
  return out;
}
