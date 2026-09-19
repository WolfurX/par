// Helius connection and Token-2022 mint state reader.
// Raw-unit rule: everything here is raw; multiplier math is `effectiveMultiplier` from units.ts.

import { Connection, PublicKey } from "@solana/web3.js";
import type { MintState } from "./types";

// Inlined rather than imported from ./units: Node's native TS runner (used by scripts/verify-rpc.mjs
// and scripts/registry-fill.mjs) requires explicit extensions on relative ESM specifiers, which the
// codebase's extensionless lib-to-lib imports don't have. Same formula as units.ts's effectiveMultiplier.
function effectiveMultiplier(
  cfg: { multiplier: number; newMultiplier: number; newMultiplierEffectiveTimestamp: number } | null | undefined,
  nowSec: number,
): number {
  if (!cfg) return 1;
  if (cfg.newMultiplierEffectiveTimestamp > 0 && nowSec >= cfg.newMultiplierEffectiveTimestamp) return cfg.newMultiplier;
  return cfg.multiplier;
}

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const CACHE_TTL_SEC = 60;
const BATCH_SIZE = 100;

interface CacheEntry {
  data: MintState;
  expiresAt: number; // unix seconds
}

const mintStateCache = new Map<string, CacheEntry>();

interface EpochCacheEntry {
  epoch: number;
  expiresAt: number; // unix seconds
}
let epochCache: EpochCacheEntry | null = null;

let connection: Connection | null = null;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Helius mainnet connection, commitment "processed". Cached across calls within the process. */
export function getConnection(): Connection {
  if (connection) return connection;
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error("HELIUS_API_KEY is not set");
  connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${key}`, "processed");
  return connection;
}

// Shapes of the RPC's jsonParsed Token-2022 mint output (getMultipleParsedAccounts).
// Not exported: internal to this module's parser only.
interface ParsedExtension {
  extension: string;
  state?: Record<string, unknown>;
}
interface ParsedMintInfo {
  decimals: number;
  supply: string;
  isInitialized: boolean;
  freezeAuthority?: string;
  mintAuthority?: string;
  extensions?: ParsedExtension[];
}

function extensionState(extensions: ParsedExtension[] | undefined, name: string): Record<string, unknown> | undefined {
  return extensions?.find((e) => e.extension === name)?.state;
}

/** Current Solana epoch, cached 60 s (shared TTL with mint state) so a batch of getMintStates costs one extra call, not one per mint. */
async function getCurrentEpoch(conn: Connection): Promise<number> {
  const now = nowSec();
  if (epochCache && epochCache.expiresAt > now) return epochCache.epoch;
  const info = await conn.getEpochInfo();
  epochCache = { epoch: info.epoch, expiresAt: now + CACHE_TTL_SEC };
  return info.epoch;
}

function parseMintState(mint: string, owner: string, info: ParsedMintInfo, fetchedAt: number, nowEpoch: number): MintState {
  const program: MintState["program"] = owner === TOKEN_2022_PROGRAM ? "token-2022" : "token";
  const extensions = info.extensions;

  const scaledUi = extensionState(extensions, "scaledUiAmountConfig");
  let multiplier = 1;
  let multiplierChangesAt: number | undefined;
  let pendingMultiplier: number | undefined;
  if (scaledUi) {
    const cfg = {
      multiplier: parseFloat(String(scaledUi.multiplier ?? "1")),
      newMultiplier: parseFloat(String(scaledUi.newMultiplier ?? "1")),
      newMultiplierEffectiveTimestamp: Number(scaledUi.newMultiplierEffectiveTimestamp ?? 0),
    };
    multiplier = effectiveMultiplier(cfg, fetchedAt);
    if (cfg.newMultiplierEffectiveTimestamp > 0 && fetchedAt < cfg.newMultiplierEffectiveTimestamp) {
      multiplierChangesAt = cfg.newMultiplierEffectiveTimestamp;
      pendingMultiplier = cfg.newMultiplier;
    }
  }

  // Token-2022's transferFeeConfig only makes `newerTransferFee` active once nowEpoch >= newerTransferFee.epoch;
  // before that (a ~2-epoch grace window after any fee change), `olderTransferFee` is still in effect.
  const transferFee = extensionState(extensions, "transferFeeConfig");
  const newerTransferFee = transferFee?.newerTransferFee as
    | { transferFeeBasisPoints?: number; epoch?: number }
    | undefined;
  const olderTransferFee = transferFee?.olderTransferFee as { transferFeeBasisPoints?: number } | undefined;
  let transferFeeBps = 0;
  if (newerTransferFee) {
    const newerEpoch = Number(newerTransferFee.epoch ?? 0);
    transferFeeBps =
      nowEpoch >= newerEpoch
        ? (newerTransferFee.transferFeeBasisPoints ?? 0)
        : (olderTransferFee?.transferFeeBasisPoints ?? 0);
  }

  const permanentDelegate = extensionState(extensions, "permanentDelegate");

  const pausableConfig = extensionState(extensions, "pausableConfig");
  const pausable = pausableConfig !== undefined;
  const paused = Boolean(pausableConfig?.paused ?? false);

  const transferHook = extensionState(extensions, "transferHook");
  let transferHookProgram: string | null | undefined;
  let transferHookAuthority: string | undefined;
  if (transferHook) {
    transferHookProgram = (transferHook.programId as string | null) ?? null;
    transferHookAuthority = transferHook.authority as string | undefined;
  }

  const defaultAccountState = extensionState(extensions, "defaultAccountState");
  const defaultAccountFrozen = defaultAccountState?.accountState === "frozen";

  return {
    mint,
    program,
    decimals: info.decimals,
    supplyRaw: info.supply,
    multiplier,
    multiplierChangesAt,
    pendingMultiplier,
    transferFeeBps,
    permanentDelegate: permanentDelegate?.delegate as string | undefined,
    freezeAuthority: info.freezeAuthority,
    paused,
    pausable,
    transferHookProgram,
    transferHookAuthority,
    defaultAccountFrozen,
    fetchedAt,
  };
}

/**
 * Reads Token-2022 (and plain SPL Token) mint state via getMultipleAccounts jsonParsed,
 * in batches of 100, with a 60 s in-memory cache per mint.
 */
export async function getMintStates(mints: string[]): Promise<Map<string, MintState>> {
  const unique = Array.from(new Set(mints));
  const result = new Map<string, MintState>();
  const now = nowSec();

  const toFetch: string[] = [];
  for (const mint of unique) {
    const cached = mintStateCache.get(mint);
    if (cached && cached.expiresAt > now) {
      result.set(mint, cached.data);
    } else {
      toFetch.push(mint);
    }
  }
  if (toFetch.length === 0) return result;

  const conn = getConnection();
  const nowEpoch = await getCurrentEpoch(conn);
  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BATCH_SIZE);
    const pubkeys = batch.map((m) => new PublicKey(m));
    const accounts = await conn.getMultipleParsedAccounts(pubkeys);
    const fetchedAt = nowSec();
    accounts.value.forEach((acct, idx) => {
      const mint = batch[idx];
      if (!acct || typeof acct.data !== "object" || !("parsed" in acct.data)) return;
      const parsed = (acct.data as { parsed: { info: ParsedMintInfo; type: string } }).parsed;
      if (parsed.type !== "mint") return;
      const state = parseMintState(mint, acct.owner.toBase58(), parsed.info, fetchedAt, nowEpoch);
      mintStateCache.set(mint, { data: state, expiresAt: fetchedAt + CACHE_TTL_SEC });
      result.set(mint, state);
    });
  }

  return result;
}

/** Raw (un-multiplied) token balance for owner's account(s) of a mint, summed if more than one exists. */
export async function getTokenBalanceRaw(owner: string, mint: string): Promise<bigint> {
  const conn = getConnection();
  const { value } = await conn.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) });
  let total = BigInt(0);
  for (const { account } of value) {
    const info = account.data.parsed?.info as { tokenAmount?: { amount?: string } } | undefined;
    const amount = info?.tokenAmount?.amount;
    if (amount) total += BigInt(amount);
  }
  return total;
}
