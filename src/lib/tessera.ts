// Tessera referral registration. The program is read-only to us: we derive PDAs, read state,
// and build a transaction the user signs in their own wallet. Nothing here signs or sends.
//
// Every value is checked against the pinned program on 2026-09-16:
//   program TESMgr3q4s1CK5nGz7bmkbMQBQeSt8N9wpZjTDWm2cY, programData E8LpaQ..., deploy slot 399,294,135,
//   on-chain Anchor IDL account 59WnV6Xv... byte-identical to src/lib/idl/tessera_referrals.json.
// programGuard() re-checks both at runtime; the API refuses to build when it fails.

import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { AnchorProvider, Program, type Idl, type Wallet } from "@coral-xyz/anchor";
import bs58 from "bs58";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import idlJson from "./idl/tessera_referrals.json";

export const TESSERA_REFERRAL_PROGRAM = "TESMgr3q4s1CK5nGz7bmkbMQBQeSt8N9wpZjTDWm2cY";
export const TESSERA_PROGRAM_DATA = "E8LpaQZnktnJh2CySR2QZWgq8pU858dVRDiiz4t7kbUT";
export const TESSERA_REFERRAL_CONFIG = "7BneqJjQbzgWvaw2p516rsmhtuRpthv7QshQ4jchjRoY";
export const PINNED_DEPLOY_SLOT = 399294135;
export const PINNED_IDL_SHA256 = "2d65ab78518620aab8bc25c3bb608e23300c3f1d8b5dacaf5a2f0f24020b7053";

/** Anchor allocates these two accounts on a registration; the user pays both rents. */
export const USER_REGISTRATION_BYTES = 178;
export const SENDER_FEE_CONFIG_BYTES = 385;

const PROGRAM_ID = new PublicKey(TESSERA_REFERRAL_PROGRAM);
const GUARD_TTL_MS = 3_600_000;
const RENT_TTL_MS = 3_600_000;

export interface ProgramGuard {
  ok: boolean;
  deploySlot: number;
  idlSha256: string;
  /** Seconds since the guard was last read from chain. */
  ageSec: number;
  reason?: string;
}

export interface BuiltTransaction {
  transactionBase64: string;
  rentLamports: number;
  /** Seconds since rentLamports was read from the cluster; 0 when read from this simulation. */
  rentAgeSec: number;
  simulatedUnits: number;
}

export interface RentReading {
  lamports: number;
  /** Seconds since the figure was read from the cluster. */
  ageSec: number;
}

// ---------------------------------------------------------------- connection

function rpcUrl(): string {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error("HELIUS_API_KEY is not set");
  return `https://mainnet.helius-rpc.com/?api-key=${key}`;
}

let cachedConnection: Connection | null = null;
function connection(): Connection {
  if (!cachedConnection) cachedConnection = new Connection(rpcUrl(), "confirmed");
  return cachedConnection;
}

/** Raw JSON-RPC so these reads go through the fetch cache as well as the in-memory one. */
async function rpcCall<T>(method: string, params: unknown[], revalidate: number): Promise<T> {
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "par-tessera", method, params }),
    next: { revalidate },
  });
  if (!res.ok) throw new Error(`Helius ${method} ${res.status}`);
  const body = (await res.json()) as { error?: { message: string }; result?: T };
  if (body.error) throw new Error(`Helius ${method}: ${body.error.message}`);
  return body.result as T;
}

async function accountBytes(address: PublicKey, revalidate: number): Promise<Buffer | null> {
  const result = await rpcCall<{ value: { data: [string, string] } | null }>(
    "getAccountInfo",
    [address.toBase58(), { encoding: "base64" }],
    revalidate,
  );
  const value = result?.value ?? null;
  return value ? Buffer.from(value.data[0], "base64") : null;
}

// ---------------------------------------------------------------- anchor

const READONLY_WALLET = {
  publicKey: PublicKey.default,
  signTransaction: () => Promise.reject(new Error("tessera.ts never signs")),
  signAllTransactions: () => Promise.reject(new Error("tessera.ts never signs")),
} as unknown as Wallet;

interface Builder {
  accountsStrict(accounts: Record<string, PublicKey>): Builder;
  instruction(): Promise<TransactionInstruction>;
}

interface ReferralCodeAccount {
  code: string;
  owner: PublicKey;
  isActive: boolean;
  totalReferrals: number;
}

interface TesseraProgram {
  methods: {
    registerWithReferralCode(): Builder;
    createReferralCode(code: string): Builder;
  };
  account: {
    referralCode: {
      all(filters: { memcmp: { offset: number; bytes: string } }[]): Promise<{ publicKey: PublicKey; account: ReferralCodeAccount }[]>;
    };
  };
}

let cachedProgram: TesseraProgram | null = null;
function program(): TesseraProgram {
  if (!cachedProgram) {
    const provider = new AnchorProvider(connection(), READONLY_WALLET, { commitment: "confirmed" });
    cachedProgram = new Program(idlJson as unknown as Idl, provider) as unknown as TesseraProgram;
  }
  return cachedProgram;
}

// ---------------------------------------------------------------- codes and PDAs

/** The program stores and derives codes uppercase, 6 to 12 alphanumeric (error 6000 otherwise). */
export function normalizeCode(code: string): string {
  const up = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,12}$/.test(up)) throw new Error(`invalid referral code "${code}": must be 6 to 12 alphanumeric characters`);
  return up;
}

function seed(...parts: (string | Buffer | PublicKey)[]): Buffer[] {
  return parts.map((p) => (typeof p === "string" ? Buffer.from(p, "utf8") : p instanceof PublicKey ? p.toBuffer() : p));
}

function toKey(v: string | PublicKey): PublicKey {
  return typeof v === "string" ? new PublicKey(v) : v;
}

export const pdas = {
  referralCode(code: string, owner: string | PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(seed("referral_code", normalizeCode(code), toKey(owner)), PROGRAM_ID)[0];
  },
  userRegistration(user: string | PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(seed("user_registration", toKey(user)), PROGRAM_ID)[0];
  },
  senderFeeConfig(user: string | PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(seed("sender_fee_config", toKey(user)), PROGRAM_ID)[0];
  },
  codeRegistry(code: string): PublicKey {
    return PublicKey.findProgramAddressSync(seed("code_registry", normalizeCode(code)), PROGRAM_ID)[0];
  },
  referralConfig(): PublicKey {
    return PublicKey.findProgramAddressSync(seed("referral_config"), PROGRAM_ID)[0];
  },
};

// ---------------------------------------------------------------- reads

export async function isRegistered(user: string | PublicKey): Promise<boolean> {
  const info = await connection().getAccountInfo(pdas.userRegistration(user), "confirmed");
  return info !== null;
}

/** Borsh string prefix, so getProgramAccounts can match the code field that starts at offset 8. */
function codeMemcmpBytes(code: string): string {
  const buf = Buffer.alloc(4 + code.length);
  buf.writeUInt32LE(code.length, 0);
  buf.write(code, 4, "utf8");
  return bs58.encode(buf);
}

/** Owner of a referral code, or null when no ReferralCode account holds it. Codes are globally unique. */
export async function codeOwner(code: string): Promise<string | null> {
  const norm = normalizeCode(code);
  const found = await program().account.referralCode.all([{ memcmp: { offset: 8, bytes: codeMemcmpBytes(norm) } }]);
  const match = found.find((f) => f.account.code === norm);
  return match ? match.account.owner.toBase58() : null;
}

let rentCache: { lamports: number; at: number } | null = null;

/**
 * Rent the user pays on a registration: UserRegistration plus SenderFeeConfig, read from the
 * cluster and cached an hour. The age travels with the figure so the UI can print it. On an RPC
 * failure the last good reading is served with its real age rather than a hardcoded constant.
 */
export async function registrationRent(): Promise<RentReading> {
  const now = Date.now();
  if (rentCache && now - rentCache.at < RENT_TTL_MS) {
    return { lamports: rentCache.lamports, ageSec: Math.round((now - rentCache.at) / 1000) };
  }
  try {
    const [a, b] = await Promise.all([
      rpcCall<number>("getMinimumBalanceForRentExemption", [USER_REGISTRATION_BYTES], 3600),
      rpcCall<number>("getMinimumBalanceForRentExemption", [SENDER_FEE_CONFIG_BYTES], 3600),
    ]);
    rentCache = { lamports: a + b, at: now };
    return { lamports: a + b, ageSec: 0 };
  } catch (e) {
    if (rentCache) return { lamports: rentCache.lamports, ageSec: Math.round((now - rentCache.at) / 1000) };
    throw e;
  }
}

// ---------------------------------------------------------------- guard

let guardCache: { value: Omit<ProgramGuard, "ageSec">; at: number } | null = null;

async function readGuard(): Promise<Omit<ProgramGuard, "ageSec">> {
  const progInfo = await accountBytes(PROGRAM_ID, 3600);
  if (!progInfo) return { ok: false, deploySlot: 0, idlSha256: "", reason: "program account not found" };
  const programData = new PublicKey(progInfo.subarray(4, 36));

  const pdInfo = await accountBytes(programData, 3600);
  if (!pdInfo) return { ok: false, deploySlot: 0, idlSha256: "", reason: "programData account not found" };
  const deploySlot = Number(pdInfo.readBigUInt64LE(4));

  const base = PublicKey.findProgramAddressSync([], PROGRAM_ID)[0];
  const idlAccount = await PublicKey.createWithSeed(base, "anchor:idl", PROGRAM_ID);
  const idlInfo = await accountBytes(idlAccount, 3600);
  if (!idlInfo) return { ok: false, deploySlot, idlSha256: "", reason: "IDL account not found" };
  const len = idlInfo.readUInt32LE(40);
  const liveIdl = inflateSync(idlInfo.subarray(44, 44 + len)).toString("utf8");
  const idlSha256 = createHash("sha256").update(liveIdl).digest("hex");

  const reasons: string[] = [];
  if (programData.toBase58() !== TESSERA_PROGRAM_DATA) reasons.push(`programData is ${programData.toBase58()}, pinned ${TESSERA_PROGRAM_DATA}`);
  if (deploySlot !== PINNED_DEPLOY_SLOT) reasons.push(`deploy slot is ${deploySlot}, pinned ${PINNED_DEPLOY_SLOT}`);
  if (idlSha256 !== PINNED_IDL_SHA256) reasons.push(`IDL sha256 is ${idlSha256}, pinned ${PINNED_IDL_SHA256}`);
  return reasons.length
    ? { ok: false, deploySlot, idlSha256, reason: `Tessera program changed: ${reasons.join("; ")}` }
    : { ok: true, deploySlot, idlSha256 };
}

/** Cached one hour. On an RPC failure the last good reading is served and its age is printed. */
export async function programGuard(): Promise<ProgramGuard> {
  const now = Date.now();
  if (guardCache && now - guardCache.at < GUARD_TTL_MS) {
    return { ...guardCache.value, ageSec: Math.round((now - guardCache.at) / 1000) };
  }
  try {
    const value = await readGuard();
    guardCache = { value, at: now };
    return { ...value, ageSec: 0 };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (guardCache) {
      return { ...guardCache.value, ageSec: Math.round((now - guardCache.at) / 1000), reason: `last good reading, upstream failing: ${message}` };
    }
    return { ok: false, deploySlot: 0, idlSha256: "", ageSec: 0, reason: message };
  }
}

// ---------------------------------------------------------------- builders

async function simulate(tx: VersionedTransaction, addresses: PublicKey[]) {
  const res = await connection().simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "processed",
    accounts: { encoding: "base64", addresses: addresses.map((a) => a.toBase58()) },
  });
  if (res.value.err) {
    const log = (res.value.logs ?? []).filter((l) => /Error|error|failed/.test(l)).slice(-3).join(" | ");
    throw new Error(`simulation failed: ${JSON.stringify(res.value.err)}${log ? ` (${log})` : ""}`);
  }
  return res.value;
}

async function compile(payer: PublicKey, instructions: TransactionInstruction[]): Promise<VersionedTransaction> {
  const { blockhash } = await connection().getLatestBlockhash("confirmed");
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message();
  return new VersionedTransaction(message);
}

/**
 * register_with_referral_code for a wallet that has never registered. Re-registering silently
 * overwrites the wallet's referrers, so a wallet whose UserRegistration PDA exists is refused here.
 */
export async function buildRegistration(opts: { user: string | PublicKey; code: string; codeOwner: string | PublicKey }): Promise<BuiltTransaction> {
  const user = toKey(opts.user);
  const owner = toKey(opts.codeOwner);
  const code = normalizeCode(opts.code);
  if (user.equals(owner)) throw new Error("the code owner cannot register under its own code (error 6002)");

  const userRegistration = pdas.userRegistration(user);
  const senderFeeConfig = pdas.senderFeeConfig(user);
  const c = connection();
  const [existing, ownerRegistrationInfo] = await Promise.all([
    c.getAccountInfo(userRegistration, "confirmed"),
    c.getAccountInfo(pdas.userRegistration(owner), "confirmed"),
  ]);
  if (existing) throw new Error("wallet is already registered; registering again would overwrite its referrers");

  // Anchor None for the optional referrer_registration is the program id itself.
  const referrerRegistration = ownerRegistrationInfo ? pdas.userRegistration(owner) : PROGRAM_ID;

  const ix = await program()
    .methods.registerWithReferralCode()
    .accountsStrict({
      referralCode: pdas.referralCode(code, owner),
      userRegistration,
      referralConfig: pdas.referralConfig(),
      referrerRegistration,
      senderFeeConfig,
      user,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const tx = await compile(user, [ix]);
  const sim = await simulate(tx, [userRegistration, senderFeeConfig]);
  const rent = await registrationRent();
  return {
    transactionBase64: Buffer.from(tx.serialize()).toString("base64"),
    rentLamports: rent.lamports,
    rentAgeSec: rent.ageSec,
    simulatedUnits: sim.unitsConsumed ?? 0,
  };
}

/** One-time setup: the app's own code, signed by the fee wallet. Rent is read back from the simulation. */
export async function buildCreateCode(opts: { owner: string | PublicKey; code: string }): Promise<BuiltTransaction> {
  const owner = toKey(opts.owner);
  const code = normalizeCode(opts.code);
  const referralCode = pdas.referralCode(code, owner);
  const codeRegistry = pdas.codeRegistry(code);
  if (await connection().getAccountInfo(codeRegistry, "confirmed")) {
    throw new Error(`referral code ${code} is already taken by another owner (error 6022)`);
  }

  const ix = await program()
    .methods.createReferralCode(code)
    .accountsStrict({ referralCode, codeRegistry, owner, systemProgram: SystemProgram.programId })
    .instruction();

  const tx = await compile(owner, [ix]);
  const sim = await simulate(tx, [referralCode, codeRegistry]);
  const rentLamports = (sim.accounts ?? []).reduce((sum, a) => sum + (a?.lamports ?? 0), 0);
  return {
    transactionBase64: Buffer.from(tx.serialize()).toString("base64"),
    rentLamports,
    rentAgeSec: 0,
    simulatedUnits: sim.unitsConsumed ?? 0,
  };
}

// ---------------------------------------------------------------- app config

/** The app's code, uppercase, or null until TESSERA_REFERRAL_CODE is set. */
export function appReferralCode(): string | null {
  const raw = process.env.TESSERA_REFERRAL_CODE;
  if (!raw || !raw.trim()) return null;
  return normalizeCode(raw);
}

/** Owner of the app's code: the fee wallet. */
export function appCodeOwner(): string | null {
  const raw = process.env.FEE_WALLET;
  return raw && raw.trim() ? raw.trim() : null;
}
