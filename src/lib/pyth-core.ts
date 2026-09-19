// Pyth Core on-chain price accounts (keyless: any RPC, no Pyth key).
//
// The push oracle writes one PriceUpdateV2 account per (shard, feed id). The account address is a PDA
// of pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT with seeds [u16 LE shard, feed id bytes], and the
// account is owned by the Pyth receiver program.
//
// Verified on mainnet 2026-09-19: shard 1 + feed 49f6b6..5688 (Equity.US.AAPL/USD) derives
// D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW, owner rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ,
// data length 134, price 334.8159 exponent -5, verification Full.
//
// US equity feeds only update while the market publishes. Outside regular hours the account is hours
// old. That is not an error: report the age and let the caller label it.

import { Connection, PublicKey } from "@solana/web3.js";
import { PYTH_CORE_SHARD, PYTH_PUSH_ORACLE_PROGRAM } from "./registry";

const PUSH_ORACLE = new PublicKey(PYTH_PUSH_ORACLE_PROGRAM);

/** Owner of every PriceUpdateV2 account written by the push oracle. */
export const PYTH_RECEIVER_PROGRAM = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";

export type PythVerification = "full" | "partial";

export interface PythCorePrice {
  feedId: string;
  account: string;
  price: number;
  conf: number;
  exponent: number;
  publishTime: number; // unix seconds
  prevPublishTime: number;
  emaPrice: number;
  emaConf: number;
  postedSlot: number;
  verification: PythVerification;
  /** Signature count, present only when verification is partial. */
  numSignatures?: number;
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error(`pyth feed id must be 32 bytes of hex, got "${hex}"`);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (const byte of b) s += byte.toString(16).padStart(2, "0");
  return s;
}

/** PDA of the PriceUpdateV2 account for a Hermes feed id on a given shard. */
export function pythPriceAccount(feedId: string, shard: number = PYTH_CORE_SHARD): PublicKey {
  const seed = new Uint8Array(2);
  new DataView(seed.buffer).setUint16(0, shard, true);
  const [pda] = PublicKey.findProgramAddressSync([seed, hexToBytes(feedId)], PUSH_ORACLE);
  return pda;
}

// Layout: 8 discriminator, 32 write_authority, verification_level enum (tag 0 = Partial + u8 signatures,
// tag 1 = Full), then the price message: feed id 32, price i64, conf u64, exponent i32, publish_time i64,
// prev_publish_time i64, ema_price i64, ema_conf u64, then posted_slot u64.
// Partial fills all 134 bytes; Full leaves one trailing byte unused.
const VERIFICATION_OFFSET = 40;
const MIN_LEN = 133;

export function parsePriceUpdateV2(raw: Uint8Array): Omit<PythCorePrice, "account"> {
  if (raw.length < MIN_LEN) throw new Error(`PriceUpdateV2 too short: ${raw.length} bytes`);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const tag = raw[VERIFICATION_OFFSET];
  let verification: PythVerification;
  let numSignatures: number | undefined;
  let o = VERIFICATION_OFFSET + 1;
  if (tag === 0) {
    verification = "partial";
    numSignatures = raw[o];
    o += 1;
  } else if (tag === 1) {
    verification = "full";
  } else {
    throw new Error(`PriceUpdateV2: unknown verification level ${tag}`);
  }

  const feedId = bytesToHex(raw.subarray(o, o + 32));
  o += 32;
  const priceMantissa = view.getBigInt64(o, true);
  o += 8;
  const confMantissa = view.getBigUint64(o, true);
  o += 8;
  const exponent = view.getInt32(o, true);
  o += 4;
  const publishTime = Number(view.getBigInt64(o, true));
  o += 8;
  const prevPublishTime = Number(view.getBigInt64(o, true));
  o += 8;
  const emaMantissa = view.getBigInt64(o, true);
  o += 8;
  const emaConfMantissa = view.getBigUint64(o, true);
  o += 8;
  const postedSlot = Number(view.getBigUint64(o, true));

  const scale = 10 ** exponent;
  return {
    feedId,
    price: Number(priceMantissa) * scale,
    conf: Number(confMantissa) * scale,
    exponent,
    publishTime,
    prevPublishTime,
    emaPrice: Number(emaMantissa) * scale,
    emaConf: Number(emaConfMantissa) * scale,
    postedSlot,
    verification,
    numSignatures,
  };
}

let sharedConnection: Connection | null = null;
function defaultConnection(): Connection {
  if (sharedConnection) return sharedConnection;
  const key = process.env.HELIUS_API_KEY;
  const url = key
    ? `https://mainnet.helius-rpc.com/?api-key=${key}`
    : (process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.mainnet-beta.solana.com");
  sharedConnection = new Connection(url, "confirmed");
  return sharedConnection;
}

export interface PythCoreOptions {
  shard?: number;
  connection?: Connection;
}

const CACHE_TTL_SEC = 5;
const cache = new Map<string, { at: number; value: PythCorePrice }>();

/** Read many feeds in one getMultipleAccounts. Feeds with no account or a bad owner are left out of the map. */
export async function readPythCore(feedIds: string[], opts: PythCoreOptions = {}): Promise<Map<string, PythCorePrice>> {
  const shard = opts.shard ?? PYTH_CORE_SHARD;
  const out = new Map<string, PythCorePrice>();
  const now = Date.now() / 1000;

  const wanted: { feedId: string; account: PublicKey }[] = [];
  for (const feedId of new Set(feedIds)) {
    const account = pythPriceAccount(feedId, shard);
    const hit = cache.get(account.toBase58());
    if (hit && now - hit.at < CACHE_TTL_SEC) {
      out.set(feedId, hit.value);
      continue;
    }
    wanted.push({ feedId, account });
  }
  if (wanted.length === 0) return out;

  const conn = opts.connection ?? defaultConnection();
  const infos = await conn.getMultipleAccountsInfo(
    wanted.map((w) => w.account),
    "confirmed",
  );

  for (let i = 0; i < wanted.length; i++) {
    const { feedId, account } = wanted[i];
    const info = infos[i];
    if (!info) continue;
    if (info.owner.toBase58() !== PYTH_RECEIVER_PROGRAM) continue;
    // One malformed account must not reject the whole batch: skip it like a missing one.
    let parsed: Omit<PythCorePrice, "account">;
    try {
      parsed = parsePriceUpdateV2(Uint8Array.from(info.data));
    } catch (e) {
      console.warn(`[pyth-core] ${account.toBase58()}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (parsed.feedId !== feedId.toLowerCase().replace(/^0x/, "")) continue;
    const value: PythCorePrice = { ...parsed, account: account.toBase58() };
    cache.set(account.toBase58(), { at: Date.now() / 1000, value });
    out.set(feedId, value);
  }
  return out;
}

export async function readPythCoreOne(feedId: string, opts: PythCoreOptions = {}): Promise<PythCorePrice | null> {
  const m = await readPythCore([feedId], opts);
  return m.get(feedId) ?? null;
}
