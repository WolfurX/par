// Jupiter Swap V2 /build path: quote, assemble the v0 transaction, simulate at processed, size compute units,
// measure delivery per route label, compare with jup.ag's own /order. Nothing here ever broadcasts; sends live in
// /api/send. Facts this file relies on were verified against mainnet on 2026-09-16 (see scratchpad research).

import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { QuoteRequest, QuoteResult, Side } from "./types";
import { USDC_MINT, wrapperByMint } from "./registry";
import { screenAddress } from "@/lib/screening";

// ---------- constants ----------

const JUP_BASE = "https://api.jup.ag/swap/v2";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const SIM_CU_LIMIT = 1_400_000;
const CU_HEADROOM = 1.2;
const DELIVERY_FLOOR = 0.999; // a label delivering under this ratio of the quote is excluded for that mint
const TAKER_TTL_MS = 60 * 60 * 1000;
const MIN_TAKER_LAMPORTS = 10_000_000; // 0.01 SOL: fees plus a Token-2022 ATA rent in simulation
// Request windows, enforced in acquireSlot. Keyless: live headers on 2026-09-16 showed 5 requests per ~10 s, 429 on
// the 6th. Keyed: the live gateway uses 10 s windows; a Free key measured 10 per window on 2026-09-19 (429 on the 11th),
// a Developer key would be 100. JUPITER_WINDOW_CALLS sets this module's share (default 8, leaving 2 for jupprice.ts);
// raise it to 80 on the Developer tier. Each server process paces itself; there is no cross-process gate.
const KEYLESS_WINDOW = { ms: 11_000, calls: 5 };
const KEYED_WINDOW = { ms: 10_000, calls: Math.max(1, Number(process.env.JUPITER_WINDOW_CALLS ?? 8) || 8) };
const MAX_IN_FLIGHT = 4;
const TAKER_MISS_TTL_MS = 5 * 60 * 1000; // after a failed taker search, do not repeat the discovery walk for 5 min
const TAKER_POOL_WARN_BELOW = 3; // warn when fewer pinned USDC wallets than this are viable, before the pool is dry

// Seed for program id -> DEX label; refreshed from /program-id-to-label (107 entries on 2026-09-19).
const SEED_PROGRAM_LABELS: Record<string, string> = {
  MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms: "Manifest",
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: "Meteora DLMM",
  BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi: "BisonFi",
  goonuddtQRrWqqn5nFyczVKaie28f3kDkHWkHtURSLE: "GoonFi V2",
  TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH: "TesseraV",
  FLUX6xBayGxLX9UcimVRxXFMHH6q43mAbRvDzSpCsvfK: "Flux",
  REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2: "Byreal",
  DEXYosS6oEGvk8uCDayvwEZz4qEyDJRf9nFgYCaqPMTm: "1DEX",
  "9H6tua7jkLhdm3w8BvgpTn5LZNU7g4ZynDmCiNN3q6Rp": "HumidiFi",
};

// ---------- env ----------

function heliusUrl(): string {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new JupiterError("HELIUS_API_KEY is not set", 500, "config");
  return `https://mainnet.helius-rpc.com/?api-key=${key}`;
}

export function feeBps(): number {
  const n = Number(process.env.FEE_BPS ?? "0");
  if (!Number.isInteger(n) || n < 0 || n > 10000) throw new JupiterError("FEE_BPS must be an integer 0..10000", 500, "config");
  return n;
}

export function feeWallet(): PublicKey {
  const w = process.env.FEE_WALLET;
  if (!w) throw new JupiterError("FEE_WALLET is not set", 500, "config");
  return new PublicKey(w);
}

/** The USDC associated token account of FEE_WALLET (Token program). Input side on buys, output side on sells. */
export function feeAccount(): PublicKey {
  return getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), feeWallet(), false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
}

export class JupiterError extends Error {
  status: number;
  code: string;
  /** Structured fields a route can pass through (blocked: reason; insufficient_balance: mint, haveRaw, needRaw). */
  details?: Record<string, unknown>;
  constructor(message: string, status = 502, code = "jupiter", details?: Record<string, unknown>) {
    super(message);
    this.name = "JupiterError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ---------- RPC ----------

type RpcAccount = {
  lamports: number;
  owner: string;
  data: { parsed?: { type?: string; info?: Record<string, unknown> }; program?: string } | string[];
} | null;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(heliusUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  const j = (await r.json()) as { result?: T; error?: { code: number; message: string } };
  if (j.error) throw new JupiterError(`${method}: ${j.error.message}`, 502, "rpc");
  return j.result as T;
}

function tokenAmountOf(acc: RpcAccount): bigint {
  if (!acc || Array.isArray(acc.data) || !acc.data.parsed?.info) return BigInt(0);
  const ta = acc.data.parsed.info.tokenAmount as { amount?: string } | undefined;
  return BigInt(ta?.amount ?? "0");
}

async function getMultipleAccounts(addresses: string[], commitment: "processed" | "confirmed" = "processed"): Promise<RpcAccount[]> {
  if (addresses.length === 0) return [];
  const res = await rpc<{ value: RpcAccount[] }>("getMultipleAccounts", [addresses, { encoding: "jsonParsed", commitment }]);
  return res.value;
}

const mintProgramCache = new Map<string, string>();
/** Token program that owns a mint. USDC is the Token program; every registry wrapper is Token-2022. Others are read on-chain. */
export async function mintProgram(mint: string): Promise<PublicKey> {
  if (mint === USDC_MINT) return TOKEN_PROGRAM_ID;
  if (wrapperByMint.has(mint)) return TOKEN_2022_PROGRAM_ID;
  let owner = mintProgramCache.get(mint);
  if (!owner) {
    const [acc] = await getMultipleAccounts([mint], "confirmed");
    if (!acc) throw new JupiterError(`mint ${mint} not found`, 404, "mint");
    owner = acc.owner;
    mintProgramCache.set(mint, owner);
  }
  return new PublicKey(owner);
}

export async function ataFor(owner: string, mint: string): Promise<string> {
  const program = await mintProgram(mint);
  return getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, program, ASSOCIATED_TOKEN_PROGRAM_ID).toBase58();
}

/** Raw balance of owner's associated token account for mint; 0 when the account does not exist. */
export async function tokenBalanceRaw(owner: string, mint: string): Promise<bigint> {
  const ata = await ataFor(owner, mint);
  const [acc] = await getMultipleAccounts([ata]);
  return tokenAmountOf(acc);
}

// ---------- Jupiter call pacing ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let inFlight = 0;
const waiters: (() => void)[] = [];
const sentAt: number[] = [];
let pacingGate: Promise<void> = Promise.resolve();

async function acquireSlot(): Promise<void> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight++;
  // At most pace.calls per pace.ms, decided under a gate so concurrent callers queue in order.
  const pace = process.env.JUPITER_API_KEY ? KEYED_WINDOW : KEYLESS_WINDOW;
  const prev = pacingGate;
  let open!: () => void;
  pacingGate = new Promise<void>((r) => (open = r));
  await prev;
  try {
    const now = Date.now();
    while (sentAt.length && now - sentAt[0] > pace.ms) sentAt.shift();
    if (sentAt.length >= pace.calls) {
      const wait = pace.ms - (now - sentAt[0]) + 50;
      await sleep(wait);
      sentAt.shift();
    }
    sentAt.push(Date.now());
  } finally {
    open();
  }
}

function releaseSlot(): void {
  inFlight--;
  const next = waiters.shift();
  if (next) next();
}

interface JupResponse<T> {
  status: number;
  body: T;
}

async function jupGet<T>(path: string, params: URLSearchParams, revalidate?: number): Promise<JupResponse<T>> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (process.env.JUPITER_API_KEY) headers["x-api-key"] = process.env.JUPITER_API_KEY;
  const url = `${JUP_BASE}${path}?${params.toString()}`;
  const init: RequestInit & { next?: { revalidate: number } } =
    revalidate !== undefined ? { headers, next: { revalidate } } : { headers, cache: "no-store" };
  for (let attempt = 0; attempt < 2; attempt++) {
    await acquireSlot();
    let r: Response;
    try {
      r = await fetch(url, init);
    } finally {
      releaseSlot();
    }
    if (r.status === 429 && attempt === 0) {
      const reset = Number(r.headers.get("x-ratelimit-reset"));
      const wait = Number.isFinite(reset) && reset > 0 ? Math.min(15_000, Math.max(0, reset * 1000 - Date.now()) + 200) : 3_000;
      await sleep(wait);
      continue;
    }
    const text = await r.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text.slice(0, 200) };
    }
    return { status: r.status, body: body as T };
  }
  throw new JupiterError("Jupiter rate limit: retry after reset still 429", 429, "ratelimit");
}

// ---------- program id -> label ----------

let programLabels: { map: Record<string, string>; at: number } = { map: SEED_PROGRAM_LABELS, at: 0 };

async function programLabelMap(): Promise<Record<string, string>> {
  if (Date.now() - programLabels.at < 60 * 60 * 1000) return programLabels.map;
  try {
    const r = await jupGet<Record<string, string>>("/program-id-to-label", new URLSearchParams(), 3600);
    if (r.status === 200 && typeof r.body === "object" && r.body) {
      programLabels = { map: { ...SEED_PROGRAM_LABELS, ...r.body }, at: Date.now() };
    } else {
      programLabels = { ...programLabels, at: Date.now() - 55 * 60 * 1000 }; // retry in 5 min, keep the seed
    }
  } catch {
    programLabels = { ...programLabels, at: Date.now() - 55 * 60 * 1000 };
  }
  return programLabels.map;
}

/** The DEX label of the deepest failing program in simulation logs, walking back through invokes when the failing program is not a DEX. */
function failingLabel(logs: string[], labels: Record<string, string>): string | undefined {
  const invoked: string[] = [];
  for (const line of logs) {
    const inv = /^Program (\S+) invoke/.exec(line);
    if (inv) {
      invoked.push(inv[1]);
      continue;
    }
    const failed = /^Program (\S+) failed/.exec(line);
    if (failed) {
      if (labels[failed[1]]) return labels[failed[1]];
      for (let i = invoked.length - 1; i >= 0; i--) {
        if (labels[invoked[i]]) return labels[invoked[i]];
      }
      return undefined;
    }
  }
  return undefined;
}

// ---------- per-mint exclusions and measured labels ----------

const excludedByMint = new Map<string, Set<string>>();
const goodLabelsByMint = new Map<string, Set<string>>();

export function excludedDexesFor(mint: string): string[] {
  expireExclusions(mint);
  return [...(excludedByMint.get(mint) ?? [])].sort();
}

function excludeForMint(mint: string, labels: string[]): void {
  const set = excludedByMint.get(mint) ?? new Set<string>();
  for (const l of labels) set.add(l);
  excludedByMint.set(mint, set);
}

/**
 * Record a measured route. A ratio at or above the floor marks every leg good. A short-pay only blames the LAST leg
 * (the one that delivers the output token, where a transfer-fee-ignoring adapter shows up), only when the ratio is a
 * real short-pay (under SHORTPAY_FLOOR, not multi-hop rounding), and never a leg already measured good. Exclusions
 * expire after EXCLUSION_TTL_MS so one bad measurement cannot route a mint around its main pool for the rest of the run.
 */
const SHORTPAY_FLOOR = 0.9975;
const EXCLUSION_TTL_MS = 60 * 60 * 1000;
const excludedAt = new Map<string, number>(); // `${mint}:${label}` -> ms
function recordDelivery(mint: string, labels: string[], ratio: number): string[] {
  const good = goodLabelsByMint.get(mint) ?? new Set<string>();
  if (ratio >= DELIVERY_FLOOR) {
    for (const l of labels) good.add(l);
    goodLabelsByMint.set(mint, good);
    return [];
  }
  if (ratio >= SHORTPAY_FLOOR || labels.length === 0) return [];
  const last = labels[labels.length - 1];
  if (good.has(last)) return [];
  excludeForMint(mint, [last]);
  excludedAt.set(`${mint}:${last}`, Date.now());
  return [last];
}
function expireExclusions(mint: string): void {
  const set = excludedByMint.get(mint);
  if (!set) return;
  for (const l of [...set]) {
    const at = excludedAt.get(`${mint}:${l}`) ?? 0;
    if (Date.now() - at > EXCLUSION_TTL_MS) {
      set.delete(l);
      excludedAt.delete(`${mint}:${l}`);
    }
  }
}

// ---------- /build ----------

interface JupIx {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}

interface RoutePlanLeg {
  percent: number;
  swapInfo: { ammKey: string; label: string; inputMint: string; outputMint: string; inAmount: string; outAmount: string };
}

export interface BuildResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: string | number;
  routePlan: RoutePlanLeg[];
  computeBudgetInstructions?: JupIx[];
  setupInstructions?: JupIx[];
  swapInstruction: JupIx;
  cleanupInstruction?: JupIx | null;
  otherInstructions?: JupIx[];
  addressesByLookupTableAddress?: Record<string, string[]>;
  blockhashWithMetadata?: { blockhash: number[] | string; lastValidBlockHeight: number };
}

interface BuildParams {
  inputMint: string;
  outputMint: string;
  amountRaw: string;
  taker: string;
  slippageBps: number;
  excludeDexes?: string[];
  dexes?: string[];
  restrictIntermediateTokens?: boolean;
  maxAccounts?: number;
}

async function jupBuild(p: BuildParams): Promise<BuildResponse> {
  const q = new URLSearchParams({
    inputMint: p.inputMint,
    outputMint: p.outputMint,
    amount: p.amountRaw,
    taker: p.taker,
    slippageBps: String(p.slippageBps),
  });
  const bps = feeBps();
  if (bps > 0) {
    q.set("platformFeeBps", String(bps));
    q.set("feeAccount", feeAccount().toBase58());
  }
  if (p.dexes?.length) q.set("dexes", p.dexes.join(","));
  else if (p.excludeDexes?.length) q.set("excludeDexes", p.excludeDexes.join(","));
  if (p.restrictIntermediateTokens) q.set("restrictIntermediateTokens", "true");
  if (p.maxAccounts) q.set("maxAccounts", String(p.maxAccounts));
  const r = await jupGet<BuildResponse & { error?: string }>("/build", q);
  if (r.status !== 200 || !r.body?.swapInstruction) {
    const msg = (r.body as { error?: string })?.error ?? `HTTP ${r.status}`;
    throw new JupiterError(`/build: ${msg}`, r.status === 429 ? 429 : 502, "build");
  }
  return r.body;
}

function toIx(o: JupIx): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(o.programId),
    keys: o.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(o.data, "base64"),
  });
}

function isCuLimitIx(o: JupIx): boolean {
  return o.programId === ComputeBudgetProgram.programId.toBase58() && Buffer.from(o.data, "base64")[0] === 2;
}

/** Assemble the v0 transaction from a /build response. /build returns the CU price only; the limit is ours. */
export function assemble(b: BuildResponse, taker: string, blockhash: string, cuLimit: number): VersionedTransaction {
  const budget = (b.computeBudgetInstructions ?? []).filter((ix) => !isCuLimitIx(ix));
  const ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
    ...budget.map(toIx),
    ...(b.setupInstructions ?? []).map(toIx),
    toIx(b.swapInstruction),
    ...(b.cleanupInstruction ? [toIx(b.cleanupInstruction)] : []),
    ...(b.otherInstructions ?? []).map(toIx),
  ];
  const alts = Object.entries(b.addressesByLookupTableAddress ?? {}).map(
    ([key, addrs]) =>
      new AddressLookupTableAccount({
        key: new PublicKey(key),
        state: {
          deactivationSlot: BigInt("18446744073709551615"),
          lastExtendedSlot: 0,
          lastExtendedSlotStartIndex: 0,
          authority: undefined,
          addresses: addrs.map((a) => new PublicKey(a)),
        },
      }),
  );
  const msg = new TransactionMessage({ payerKey: new PublicKey(taker), recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(alts);
  return new VersionedTransaction(msg);
}

function buildBlockhash(b: BuildResponse): string {
  const bh = b.blockhashWithMetadata?.blockhash;
  if (Array.isArray(bh)) return new PublicKey(Uint8Array.from(bh)).toBase58();
  if (typeof bh === "string" && bh) return bh;
  return PublicKey.default.toBase58(); // replaced by replaceRecentBlockhash in simulation
}

// ---------- simulation ----------

export interface SimResult {
  err: unknown;
  logs: string[];
  unitsConsumed: number;
  slot: number;
  post: bigint[]; // token amounts of the watched accounts after the simulation
}

async function simulate(tx: VersionedTransaction, watch: string[]): Promise<SimResult> {
  const b64 = Buffer.from(tx.serialize()).toString("base64");
  const res = await rpc<{ context: { slot: number }; value: { err: unknown; logs: string[] | null; unitsConsumed?: number; accounts?: RpcAccount[] } }>(
    "simulateTransaction",
    [
      b64,
      {
        encoding: "base64",
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "processed",
        accounts: { encoding: "jsonParsed", addresses: watch },
      },
    ],
  );
  const v = res.value;
  return {
    err: v.err ?? null,
    logs: v.logs ?? [],
    unitsConsumed: v.unitsConsumed ?? 0,
    slot: res.context.slot,
    post: (v.accounts ?? []).map(tokenAmountOf),
  };
}

function describeSimError(sim: SimResult): string {
  const errText = typeof sim.err === "string" ? sim.err : JSON.stringify(sim.err);
  const tail = sim.logs.filter((l) => /failed|Error|error/.test(l)).slice(-2).join(" | ");
  return `${errText}${tail ? ` (${tail.slice(0, 240)})` : ""}`;
}

// ---------- taker selection ----------

const takerCache = new Map<string, { taker: string; at: number }>();
const takerMissAt = new Map<string, number>();

// Helius rejects getTokenLargestAccounts on USDC ("Too many accounts requested (10000000 pubkeys)") and the public
// RPC answers it with 429 (both probed 2026-09-19), so buy-side placeholders come from this list of system-owned
// wallets holding USDC (read 2026-09-19: 1.95M, 1.79M, 1.50M, 171K and 7.1K USDC). Balance and ownership are re-read
// before use; they only ever act as simulation payers. pickTaker warns when fewer than TAKER_POOL_WARN_BELOW of them
// are viable and, when none is, falls back to wallets discovered through the registry: owners of the largest token
// accounts of every pinned wrapper that also hold USDC (getTokenLargestAccounts works on those mints).
const USDC_TAKER_CANDIDATES = [
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
  "2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm",
  "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS",
  "u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w",
  "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL",
];

export type TakerCandidate = { owner: string; amount: bigint };

const byAmountDesc = (a: TakerCandidate, b: TakerCandidate) => (a.amount < b.amount ? 1 : a.amount > b.amount ? -1 : 0);

function parseTokenAccounts(accounts: RpcAccount[], amounts?: string[]): TakerCandidate[] {
  const out: TakerCandidate[] = [];
  accounts.forEach((acc, i) => {
    if (!acc || Array.isArray(acc.data) || !acc.data.parsed?.info) return;
    const info = acc.data.parsed.info as { owner?: string; state?: string; tokenAmount?: { amount: string } };
    if (info.state !== "initialized" || !info.owner) return;
    out.push({ owner: info.owner, amount: BigInt(amounts ? amounts[i] : (info.tokenAmount?.amount ?? "0")) });
  });
  return out;
}

/** The RPC's 20 largest token accounts of mint, with owners, largest first. */
async function largestHolders(mint: string): Promise<TakerCandidate[]> {
  const largest = await rpc<{ value: { address: string; amount: string }[] }>("getTokenLargestAccounts", [mint, { commitment: "confirmed" }]);
  const accounts = await getMultipleAccounts(largest.value.map((x) => x.address), "confirmed");
  return parseTokenAccounts(accounts, largest.value.map((x) => x.amount));
}

/** USDC associated token accounts of these owners, largest first, empty ones dropped. */
async function usdcHolders(owners: string[]): Promise<TakerCandidate[]> {
  const out: TakerCandidate[] = [];
  for (let i = 0; i < owners.length; i += 100) {
    const atas = owners
      .slice(i, i + 100)
      .map((o) => getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), new PublicKey(o), true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID).toBase58());
    out.push(...parseTokenAccounts(await getMultipleAccounts(atas, "confirmed")));
  }
  return out.filter((c) => c.amount > BigInt(0)).sort(byAmountDesc);
}

/** Owners of the largest token accounts of every registry wrapper, minus the pinned list: wallets that trade these tokens. */
async function wrapperTraderOwners(): Promise<string[]> {
  const owners = new Set<string>();
  for (const mint of wrapperByMint.keys()) {
    try {
      for (const c of await largestHolders(mint)) owners.add(c.owner);
    } catch {
      // one mint's lookup failing must not sink the walk
    }
  }
  for (const o of USDC_TAKER_CANDIDATES) owners.delete(o);
  return [...owners];
}

/** Candidates whose owner is a system-owned wallet with SOL for fees and rent, order kept. */
async function viableTakers(candidates: TakerCandidate[]): Promise<TakerCandidate[]> {
  const out: TakerCandidate[] = [];
  for (let i = 0; i < candidates.length; i += 100) {
    const chunk = candidates.slice(i, i + 100);
    const owners = await getMultipleAccounts(
      chunk.map((c) => c.owner),
      "confirmed",
    );
    chunk.forEach((c, j) => {
      const o = owners[j];
      if (o && o.owner === SYSTEM_PROGRAM && o.lamports >= MIN_TAKER_LAMPORTS) out.push(c);
    });
  }
  return out;
}

/** Viable USDC placeholder takers, largest USDC balance first: the pinned list, or the wallets discovered through the registry. */
export async function viableUsdcTakers(source: "pinned" | "discovered"): Promise<TakerCandidate[]> {
  const owners = source === "pinned" ? USDC_TAKER_CANDIDATES : await wrapperTraderOwners();
  return viableTakers(await usdcHolders(owners));
}

/** Largest holder of mint whose owner is a system-owned wallet with SOL for fees; cached for 1 h, a miss for 5 min. */
async function pickTaker(mint: string): Promise<string> {
  const hit = takerCache.get(mint);
  if (hit && Date.now() - hit.at < TAKER_TTL_MS) return hit.taker;
  const missedAt = takerMissAt.get(mint);
  if (missedAt && Date.now() - missedAt < TAKER_MISS_TTL_MS) {
    throw new JupiterError(`no placeholder taker for ${mint} (last search ${Math.round((Date.now() - missedAt) / 1000)} s ago)`, 503, "taker");
  }
  let viable: TakerCandidate[];
  if (mint === USDC_MINT) {
    viable = await viableUsdcTakers("pinned");
    if (viable.length < TAKER_POOL_WARN_BELOW) {
      console.warn(`[jupiter] USDC placeholder pool: ${viable.length} of ${USDC_TAKER_CANDIDATES.length} pinned wallets viable; refresh USDC_TAKER_CANDIDATES in src/lib/jupiter.ts`);
    }
    if (!viable.length) {
      viable = await viableUsdcTakers("discovered");
      console.warn(`[jupiter] USDC placeholder pool: discovery through the registry wrappers' largest holders found ${viable.length} viable wallets`);
    }
  } else {
    viable = await viableTakers(await largestHolders(mint));
  }
  if (!viable.length) {
    takerMissAt.set(mint, Date.now());
    throw new JupiterError(`no system-owned funded holder of ${mint} found`, 503, "taker");
  }
  takerCache.set(mint, { taker: viable[0].owner, at: Date.now() });
  return viable[0].owner;
}

// ---------- /order comparison ----------

const orderLastGood = new Map<string, { outAmount: string; feeBps: number; at: number }>();

interface OrderCompare {
  jupOrderOutRaw?: string;
  jupOrderFeeBps?: number;
  jupOrderAgeSec?: number;
  jupOrderStale?: boolean;
}

/** jup.ag's own path at this size (meta-aggregator, its 10 bps on this pair). No taker: quote only. Cached 30 s, last good served on failure. */
export async function orderCompare(inputMint: string, outputMint: string, amountRaw: string): Promise<OrderCompare> {
  const key = `${inputMint}/${outputMint}/${amountRaw}`;
  try {
    const r = await jupGet<{ outAmount?: string; feeBps?: number; error?: string }>(
      "/order",
      new URLSearchParams({ inputMint, outputMint, amount: amountRaw }),
      30,
    );
    if (r.status === 200 && r.body?.outAmount) {
      const entry = { outAmount: r.body.outAmount, feeBps: Number(r.body.feeBps ?? 0), at: Date.now() };
      orderLastGood.set(key, entry);
      return { jupOrderOutRaw: entry.outAmount, jupOrderFeeBps: entry.feeBps, jupOrderAgeSec: 0, jupOrderStale: false };
    }
  } catch {
    // fall through to last good
  }
  const last = orderLastGood.get(key);
  if (!last) return {};
  return { jupOrderOutRaw: last.outAmount, jupOrderFeeBps: last.feeBps, jupOrderAgeSec: Math.round((Date.now() - last.at) / 1000), jupOrderStale: true };
}

// ---------- quoteAtSize ----------

const SIZED_TTL_MS = 120_000;
const sizedQuotes = new Map<string, { at: number; value: QuoteResult }>();

/**
 * Quote only: no taker, no build, no simulation. Cached 120 s per mint, side and size (the matrix prints each
 * quote's age; the buy screen re-quotes and simulates before signing). /order takes its own fee on the USDC leg
 * (reported as feeBps, 10 bps on the pairs checked 2026-09-20), which is what FEE_BPS also assumes.
 */
export async function quoteAtSize(mint: string, side: Side, amountRaw: string): Promise<QuoteResult | null> {
  const exclude = excludedDexesFor(mint);
  const key = `${mint}:${side}:${amountRaw}:${exclude.join(",")}`;
  const hit = sizedQuotes.get(key);
  if (hit && Date.now() - hit.at < SIZED_TTL_MS) return hit.value;
  const { inputMint, outputMint } = mintsFor(mint, side);
  // /order honours excludeDexes on its Metis routes (live 2026-09-23: excludeDexes=Manifest took Manifest out of
  // the PreStocks OPENAI route). It can also return a non-Metis router (OKX DEX Router, seen 2026-09-23 on OPENAI
  // at 1,000 USDC with excludeDexes=Manifest); that route is one opaque leg excludeDexes does not reach.
  const q = new URLSearchParams({ inputMint, outputMint, amount: amountRaw });
  if (exclude.length) q.set("excludeDexes", exclude.join(","));
  const r = await jupGet<{ outAmount?: string; otherAmountThreshold?: string; priceImpactPct?: string; slippageBps?: number; feeBps?: number; routePlan?: RoutePlanLeg[] }>(
    "/order",
    q,
  );
  const b = r.body;
  if (r.status !== 200 || !b.outAmount) return null;
  const value: QuoteResult = {
    mint,
    side,
    inputMint,
    outputMint,
    inAmountRaw: amountRaw,
    outAmountRaw: b.outAmount,
    expectedRaw: b.outAmount,
    minimumRaw: b.otherAmountThreshold ?? b.outAmount,
    slippageBps: Number(b.slippageBps ?? 0),
    priceImpactPct: Number(b.priceImpactPct) || 0,
    feeBps: Number(b.feeBps ?? 0),
    feeAmountRaw: feeEstimate(side, amountRaw, b.outAmount).toString(),
    routeLabels: (b.routePlan ?? []).map((l) => l.swapInfo.label),
    excludedDexes: exclude,
    quotedAt: Math.floor(Date.now() / 1000),
  };
  sizedQuotes.set(key, { at: Date.now(), value });
  return value;
}

// ---------- shared quote-and-simulate ladder ----------

export function defaultSlippageBps(liquidityUsd?: number): number {
  return liquidityUsd !== undefined && liquidityUsd > 500_000 ? 50 : 100;
}

function mintsFor(mint: string, side: Side): { inputMint: string; outputMint: string } {
  return side === "buy" ? { inputMint: USDC_MINT, outputMint: mint } : { inputMint: mint, outputMint: USDC_MINT };
}

interface Attempt {
  build: BuildResponse;
  tx: VersionedTransaction;
  sim: SimResult | null;
  excludeDexes: string[];
}

interface LadderResult {
  attempt: Attempt;
  ok: boolean; // a simulation ran and succeeded
  reason?: string;
  steps: string[];
}

/**
 * /build then assemble. A 5-leg route can exceed the 1232-byte message limit (AAPLx on 2026-09-19: 103 swap
 * accounts, overflow; maxAccounts=40 gave a 937-byte transaction with the same output), so retry once with fewer accounts.
 */
async function buildAndAssemble(params: BuildParams, blockhash: string | undefined, cuLimit: number): Promise<{ build: BuildResponse; tx: VersionedTransaction }> {
  for (const maxAccounts of [params.maxAccounts, 40]) {
    const build = await jupBuild({ ...params, maxAccounts });
    const tx = assemble(build, params.taker, blockhash ?? buildBlockhash(build), cuLimit);
    try {
      tx.serialize();
      return { build, tx };
    } catch {
      // message over the packet size; retry with maxAccounts=40
    }
  }
  throw new JupiterError("route does not fit one transaction (message over 1232 bytes even at maxAccounts 40)", 502, "build");
}

/**
 * Build, assemble, simulate. On a failed simulation: re-quote with restrictIntermediateTokens=true, then exclude the
 * failing label. Returns the last attempt either way; `ok` says whether a simulation passed.
 */
async function ladder(base: BuildParams, mint: string, blockhash: string | undefined, cuLimit: number, watch: string[], simulateIt: boolean): Promise<LadderResult> {
  const steps: string[] = [];
  const labels = await programLabelMap();
  const exclude = [...(base.excludeDexes ?? [])];
  let last: Attempt | undefined;
  let lastReason = "";
  let lastFailingLabel: string | undefined;
  for (let step = 0; step < 3; step++) {
    let params: BuildParams;
    if (step === 0) params = { ...base, excludeDexes: exclude };
    else if (step === 1) params = { ...base, excludeDexes: exclude, restrictIntermediateTokens: true };
    else {
      if (!lastFailingLabel || base.dexes?.length) break;
      if (exclude.includes(lastFailingLabel)) break;
      exclude.push(lastFailingLabel);
      params = { ...base, excludeDexes: exclude };
    }
    let build: BuildResponse;
    let tx: VersionedTransaction;
    try {
      ({ build, tx } = await buildAndAssemble(params, blockhash, cuLimit));
    } catch (e) {
      lastReason = e instanceof Error ? e.message : String(e);
      steps.push(`step ${step}: ${lastReason}`);
      continue;
    }
    const attempt: Attempt = { build, tx, sim: null, excludeDexes: [...exclude] };
    if (!simulateIt) return { attempt, ok: false, steps, reason: "not simulated" };
    const sim = await simulate(tx, watch);
    attempt.sim = sim;
    last = attempt;
    if (!sim.err) return { attempt, ok: true, steps };
    lastReason = describeSimError(sim);
    lastFailingLabel = failingLabel(sim.logs, labels);
    steps.push(`step ${step} route ${build.routePlan.map((r) => r.swapInfo.label).join("+")} failed: ${lastReason}${lastFailingLabel ? ` [${lastFailingLabel}]` : ""}`);
  }
  if (!last) throw new JupiterError(lastReason || "no route", 502, "build");
  return { attempt: last, ok: false, reason: lastReason, steps };
}

function feeEstimate(side: Side, amountRaw: string, outAmount: string): bigint {
  const bps = BigInt(feeBps());
  if (side === "buy") return (BigInt(amountRaw) * bps) / BigInt(10000);
  // outAmount is net of the fee taken from the USDC output; gross = net / (1 - bps/10000)
  return (BigInt(outAmount) * bps) / (BigInt(10000) - bps);
}

// ---------- getQuote ----------

export interface QuoteOptions extends QuoteRequest {
  /** Top pool liquidity in USD, used only for the default slippage (50 bps over 500K, else 100). */
  liquidityUsd?: number;
  /** Restrict routing to these labels (verification only; mutually exclusive with exclusions on Jupiter's side). */
  dexes?: string[];
}

export interface QuoteResultExt extends QuoteResult {
  takerUsed: string;
  takerIsPlaceholder: boolean;
  simulationRan: boolean;
  reason?: string;
  steps?: string[];
  computeUnits?: number;
  simulatedFeeRaw?: string;
  jupOrderAgeSec?: number;
  jupOrderStale?: boolean;
  newlyExcluded?: string[];
}

export async function getQuote(req: QuoteOptions): Promise<QuoteResultExt> {
  const { mint, side, amountRaw } = req;
  if (!/^\d+$/.test(amountRaw) || BigInt(amountRaw) <= BigInt(0)) throw new JupiterError("amountRaw must be a positive integer string", 400, "input");
  const { inputMint, outputMint } = mintsFor(mint, side);
  const slippageBps = req.slippageBps ?? defaultSlippageBps(req.liquidityUsd);
  const need = BigInt(amountRaw);

  // Taker: the caller's, if funded; else the largest system-owned holder of the input mint.
  let taker = req.taker;
  let placeholder = false;
  let reason: string | undefined;
  if (taker) {
    const have = await tokenBalanceRaw(taker, inputMint);
    if (have < need) {
      taker = undefined;
      reason = `taker holds ${have} of ${need} raw input; simulated with a placeholder`;
    }
  }
  if (!taker) {
    taker = await pickTaker(inputMint);
    placeholder = true;
  }
  let simulateIt = true;
  if (placeholder) {
    const have = await tokenBalanceRaw(taker, inputMint);
    if (have < need) {
      simulateIt = false;
      reason = `placeholder taker holds ${have} of ${need} raw input; quote not simulated`;
    }
  }

  const feeAta = feeAccount().toBase58();
  const watch = [await ataFor(taker, inputMint), await ataFor(taker, outputMint), feeAta];
  const pre = simulateIt ? (await getMultipleAccounts(watch)).map(tokenAmountOf) : [BigInt(0), BigInt(0), BigInt(0)];

  const base: BuildParams = { inputMint, outputMint, amountRaw, taker, slippageBps, excludeDexes: excludedDexesFor(mint), dexes: req.dexes };
  const comparePromise = orderCompare(inputMint, outputMint, amountRaw);

  let result = await ladder(base, mint, undefined, SIM_CU_LIMIT, watch, simulateIt);
  const newlyExcluded: string[] = [];

  const readAttempt = (r: LadderResult) => {
    const b = r.attempt.build;
    const labels = b.routePlan.map((l) => l.swapInfo.label);
    const out = BigInt(b.outAmount);
    let simulatedOut: bigint | undefined;
    let simulatedFee: bigint | undefined;
    if (r.ok && r.attempt.sim) {
      simulatedOut = r.attempt.sim.post[1] - pre[1];
      simulatedFee = r.attempt.sim.post[2] - pre[2];
    }
    const ratio = simulatedOut !== undefined && out > BigInt(0) ? Number(simulatedOut) / Number(out) : undefined;
    return { b, labels, out, simulatedOut, simulatedFee, ratio };
  };

  let read = readAttempt(result);
  // A measured short-pay excludes its label for the mint and re-quotes, at most twice, so the label shows the route
  // the user would actually get (PreStocks: Manifest 0.995x, then Quantum 0.998x, then Meteora DLMM + BisonFi).
  for (let round = 0; read.ratio !== undefined; round++) {
    const newly = recordDelivery(mint, read.labels, read.ratio);
    if (!newly.length) break;
    newlyExcluded.push(...newly);
    const short = `${read.labels.join("+")} delivered ${read.ratio.toFixed(6)}x the quote`;
    if (req.dexes?.length || round >= 2) {
      reason = `${short}; ${newlyExcluded.join(", ")} excluded for this mint`;
      break;
    }
    const again = await ladder({ ...base, excludeDexes: excludedDexesFor(mint) }, mint, undefined, SIM_CU_LIMIT, watch, true);
    const readAgain = readAttempt(again);
    if (!again.ok || readAgain.ratio === undefined) {
      reason = `${short}; ${newlyExcluded.join(", ")} excluded for this mint, no other route simulated`;
      break;
    }
    result = again;
    read = readAgain;
    reason = `${short}; ${newlyExcluded.join(", ")} excluded for this mint, re-quoted`;
  }

  const compare = await comparePromise;
  const { b, labels, out, simulatedOut, simulatedFee, ratio } = read;
  const simFailed = simulateIt && !result.ok;
  const expected = simFailed ? BigInt(0) : simulatedOut !== undefined ? (simulatedOut < out ? simulatedOut : out) : out;
  const fee = simulatedFee !== undefined && simulatedFee > BigInt(0) ? simulatedFee : feeEstimate(side, amountRaw, b.outAmount);
  if (simFailed) reason = `no route simulated: ${result.reason}`;

  return {
    mint,
    side,
    inputMint,
    outputMint,
    inAmountRaw: b.inAmount,
    outAmountRaw: b.outAmount,
    simulatedOutRaw: simulatedOut !== undefined ? simulatedOut.toString() : undefined,
    expectedRaw: expected.toString(),
    minimumRaw: b.otherAmountThreshold,
    slippageBps: Number(b.slippageBps ?? slippageBps),
    priceImpactPct: Number(b.priceImpactPct) || 0,
    feeBps: feeBps(),
    feeAmountRaw: fee.toString(),
    routeLabels: labels,
    deliveryRatio: ratio,
    excludedDexes: excludedDexesFor(mint),
    quotedAt: Math.floor(Date.now() / 1000),
    jupOrderOutRaw: compare.jupOrderOutRaw,
    jupOrderFeeBps: compare.jupOrderFeeBps,
    jupOrderAgeSec: compare.jupOrderAgeSec,
    jupOrderStale: compare.jupOrderStale,
    takerUsed: taker,
    takerIsPlaceholder: placeholder,
    simulationRan: result.ok,
    reason,
    steps: result.steps.length ? result.steps : undefined,
    computeUnits: result.attempt.sim?.unitsConsumed,
    simulatedFeeRaw: simulatedFee !== undefined ? simulatedFee.toString() : undefined,
    newlyExcluded: newlyExcluded.length ? newlyExcluded : undefined,
  };
}

// ---------- buildForUser ----------

export interface BuildForUserRequest {
  mint: string;
  side: Side;
  amountRaw: string;
  taker: string;
  slippageBps?: number;
  liquidityUsd?: number;
}

export interface BuildForUserResult {
  transactionBase64: string;
  expectedRaw: string;
  minimumRaw: string;
  feeAmountRaw: string;
  quotedAt: number;
  blockhash: string;
  lastValidBlockHeight: number;
  outAmountRaw: string;
  simulatedOutRaw: string;
  deliveryRatio: number;
  routeLabels: string[];
  slippageBps: number;
  computeUnitLimit: number;
  computeUnitsUsed: number;
  feeAccount: string;
  priceImpactPct: number;
}

/**
 * Build for the real taker: screening, balance, /build with the mint's exclusions, simulate at 1.4M CU, set the limit
 * to 1.2x units used, simulate the final transaction, return it unsigned. Throws JupiterError with an HTTP status.
 */
export async function buildForUser(p: BuildForUserRequest): Promise<BuildForUserResult> {
  const { mint, side, amountRaw } = p;
  if (!/^\d+$/.test(amountRaw) || BigInt(amountRaw) <= BigInt(0)) throw new JupiterError("amountRaw must be a positive integer string", 400, "input");
  let taker: PublicKey;
  try {
    taker = new PublicKey(p.taker);
  } catch {
    throw new JupiterError("taker is not a valid public key", 400, "input");
  }
  // The one screening call on the build path; /api/build relies on it rather than screening again.
  const screen = await screenAddress(taker.toBase58());
  if (screen.blocked) throw new JupiterError(`address blocked${screen.reason ? `: ${screen.reason}` : ""}`, 403, "blocked", { reason: screen.reason });

  const { inputMint, outputMint } = mintsFor(mint, side);
  const have = await tokenBalanceRaw(taker.toBase58(), inputMint);
  if (have < BigInt(amountRaw)) {
    throw new JupiterError(`insufficient ${side === "buy" ? "USDC" : "token"} balance: have ${have}, need ${amountRaw}`, 400, "insufficient_balance", {
      mint: inputMint,
      haveRaw: have.toString(),
      needRaw: amountRaw,
    });
  }
  const slippageBps = p.slippageBps ?? defaultSlippageBps(p.liquidityUsd);
  const feeAta = feeAccount().toBase58();
  const watch = [await ataFor(taker.toBase58(), inputMint), await ataFor(taker.toBase58(), outputMint), feeAta];
  const pre = (await getMultipleAccounts(watch)).map(tokenAmountOf);
  const bh = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const blockhash = bh.value.blockhash;

  const base: BuildParams = { inputMint, outputMint, amountRaw, taker: taker.toBase58(), slippageBps, excludeDexes: excludedDexesFor(mint) };

  // Sizing pass at 1.4M CU.
  const sized = await ladder(base, mint, blockhash, SIM_CU_LIMIT, watch, true);
  if (!sized.ok || !sized.attempt.sim) throw new JupiterError(`thin at this size: ${sized.reason}`, 422, "no_route");

  const finalize = async (attempt: Attempt, sim: SimResult) => {
    const limit = Math.min(SIM_CU_LIMIT, Math.ceil(sim.unitsConsumed * CU_HEADROOM));
    const tx = assemble(attempt.build, taker.toBase58(), blockhash, limit);
    const finalSim = await simulate(tx, watch);
    if (finalSim.err) throw new JupiterError(`final simulation failed at ${limit} CU: ${describeSimError(finalSim)}`, 422, "simulation");
    return { tx, limit, finalSim };
  };

  let attempt = sized.attempt;
  let fin = await finalize(attempt, sized.attempt.sim);
  let out = BigInt(attempt.build.outAmount);
  let delivered = fin.finalSim.post[1] - pre[1];
  let ratio = out > BigInt(0) ? Number(delivered) / Number(out) : 0;
  const labels = () => attempt.build.routePlan.map((l) => l.swapInfo.label);
  // A short-paying route excludes its label for the mint and rebuilds, at most twice; keep the best measured route.
  for (let round = 0; round < 2; round++) {
    if (!recordDelivery(mint, labels(), ratio).length) break;
    const again = await ladder({ ...base, excludeDexes: excludedDexesFor(mint) }, mint, blockhash, SIM_CU_LIMIT, watch, true);
    if (!again.ok || !again.attempt.sim) break;
    const f2 = await finalize(again.attempt, again.attempt.sim);
    const out2 = BigInt(again.attempt.build.outAmount);
    const d2 = f2.finalSim.post[1] - pre[1];
    const r2 = out2 > BigInt(0) ? Number(d2) / Number(out2) : 0;
    if (r2 < ratio) {
      recordDelivery(mint, again.attempt.build.routePlan.map((l) => l.swapInfo.label), r2);
      break;
    }
    attempt = again.attempt;
    fin = f2;
    out = out2;
    delivered = d2;
    ratio = r2;
  }
  const feeDelta = fin.finalSim.post[2] - pre[2];
  const expected = delivered < out ? delivered : out;
  return {
    transactionBase64: Buffer.from(fin.tx.serialize()).toString("base64"),
    expectedRaw: expected.toString(),
    minimumRaw: attempt.build.otherAmountThreshold,
    feeAmountRaw: (feeDelta > BigInt(0) ? feeDelta : feeEstimate(side, amountRaw, attempt.build.outAmount)).toString(),
    quotedAt: Math.floor(Date.now() / 1000),
    blockhash,
    lastValidBlockHeight: bh.value.lastValidBlockHeight,
    outAmountRaw: attempt.build.outAmount,
    simulatedOutRaw: delivered.toString(),
    deliveryRatio: ratio,
    routeLabels: labels(),
    slippageBps: Number(attempt.build.slippageBps ?? slippageBps),
    computeUnitLimit: fin.limit,
    computeUnitsUsed: fin.finalSim.unitsConsumed,
    feeAccount: feeAta,
    priceImpactPct: Number(attempt.build.priceImpactPct) || 0,
  };
}

// ---------- send (used by /api/send) ----------

export interface SendResult {
  signature: string;
  status: "confirmed" | "finalized" | "processed" | "timeout" | "failed";
  slot?: number;
  err?: unknown;
  taker?: string;
  takerTokenDeltas: { mint: string; deltaRaw: string; decimals: number }[];
  takerSolDeltaLamports?: number;
  feeAccount: string;
  feeAccountDeltaRaw?: string;
  networkFeeLamports?: number;
  explorerUrl: string;
}

/** Broadcast a user-signed transaction through Helius, wait up to 60 s, then read the landed deltas. */
export async function sendSigned(signedTransactionBase64: string): Promise<SendResult> {
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(signedTransactionBase64, "base64"));
  } catch {
    throw new JupiterError("signedTransactionBase64 does not decode to a transaction", 400, "input");
  }
  if (!tx.signatures.length || tx.signatures[0].every((b) => b === 0)) throw new JupiterError("transaction is not signed", 400, "input");
  const taker = tx.message.staticAccountKeys[0].toBase58();
  const feeAta = feeAccount().toBase58();

  const signature = await rpc<string>("sendTransaction", [
    signedTransactionBase64,
    { encoding: "base64", skipPreflight: false, preflightCommitment: "processed", maxRetries: 3 },
  ]);
  const explorerUrl = `https://solscan.io/tx/${signature}`;

  const deadline = Date.now() + 60_000;
  let status: SendResult["status"] = "timeout";
  let slot: number | undefined;
  let err: unknown = null;
  while (Date.now() < deadline) {
    const st = await rpc<{ value: ({ slot: number; err: unknown; confirmationStatus?: string } | null)[] }>("getSignatureStatuses", [[signature], { searchTransactionHistory: false }]);
    const s = st.value[0];
    if (s) {
      slot = s.slot;
      err = s.err ?? null;
      if (s.err) {
        status = "failed";
        break;
      }
      if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") {
        status = s.confirmationStatus;
        break;
      }
    }
    await sleep(2000);
  }
  const result: SendResult = { signature, status, slot, err, taker, takerTokenDeltas: [], feeAccount: feeAta, explorerUrl };
  if (status !== "confirmed" && status !== "finalized") return result;

  type TokenBal = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } };
  const txr = await rpc<{
    meta: { fee: number; err: unknown; preBalances: number[]; postBalances: number[]; preTokenBalances?: TokenBal[]; postTokenBalances?: TokenBal[] };
    transaction: { message: { accountKeys: { pubkey: string }[] } };
  } | null>("getTransaction", [signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);
  if (!txr) return result;
  const keys = txr.transaction.message.accountKeys.map((k) => k.pubkey);
  const pre = txr.meta.preTokenBalances ?? [];
  const post = txr.meta.postTokenBalances ?? [];
  const byIndex = new Map<number, { mint: string; owner?: string; decimals: number; pre: bigint; post: bigint }>();
  for (const b of pre) byIndex.set(b.accountIndex, { mint: b.mint, owner: b.owner, decimals: b.uiTokenAmount.decimals, pre: BigInt(b.uiTokenAmount.amount), post: BigInt(0) });
  for (const b of post) {
    const e = byIndex.get(b.accountIndex);
    if (e) e.post = BigInt(b.uiTokenAmount.amount);
    else byIndex.set(b.accountIndex, { mint: b.mint, owner: b.owner, decimals: b.uiTokenAmount.decimals, pre: BigInt(0), post: BigInt(b.uiTokenAmount.amount) });
  }
  const perMint = new Map<string, { delta: bigint; decimals: number }>();
  for (const [idx, e] of byIndex) {
    if (keys[idx] === feeAta) result.feeAccountDeltaRaw = (e.post - e.pre).toString();
    if (e.owner === taker) {
      const cur = perMint.get(e.mint) ?? { delta: BigInt(0), decimals: e.decimals };
      cur.delta += e.post - e.pre;
      perMint.set(e.mint, cur);
    }
  }
  result.takerTokenDeltas = [...perMint].map(([mint, v]) => ({ mint, deltaRaw: v.delta.toString(), decimals: v.decimals }));
  result.takerSolDeltaLamports = txr.meta.postBalances[0] - txr.meta.preBalances[0];
  result.networkFeeLamports = txr.meta.fee;
  result.err = txr.meta.err ?? null;
  return result;
}
