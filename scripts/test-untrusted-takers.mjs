// Callers pick the taker on /api/quote, /api/label and /api/build, and /api/send relays what it is given.
// Reproduces the defects fixed in src/lib/jupiter.ts: a simulation on a wallet we did not choose was recorded against
// the route's DEX for every visitor (a caller's token account with CPI Guard or a required memo, or a thin mint's
// largest holder acting as the sell-side placeholder, could make it revert; a payer moving its own tokens during the
// quote could fake a short-pay), which excluded a pool for an hour, and sendSigned relayed any signed transaction
// through the Helius key without screening its payer.
// No network: fetch and the clock are stubbed.
// Run: node --test scripts/test-untrusted-takers.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// src/lib uses extensionless imports and the "@/lib/x" alias (Next resolves both); node needs the
// extension and a real path, so add a hook, the same one scripts/test-company-stream.mjs uses.
import { register } from "node:module";
const SRC = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(
      "const SRC = " +
        JSON.stringify(SRC) +
        ";" +
        "export async function resolve(spec, ctx, next) {" +
        "  if (spec.startsWith('@/')) spec = SRC + spec.slice(2);" +
        "  try { return await next(spec, ctx); } catch (e) {" +
        "    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]sx?$/.test(spec)) return next(spec + '.ts', ctx);" +
        "    if (!spec.startsWith('.') && !spec.startsWith('file:') && !/\\.[cm]?[jt]sx?$/.test(spec)) return next(spec + '.js', ctx);" +
        "    throw e; } }",
    ),
);

const { Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } = await import("@solana/web3.js");
const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");

process.env.HELIUS_API_KEY = "test";
process.env.JUPITER_API_KEY = "test";
process.env.JUPITER_WINDOW_CALLS = "1000"; // no pacing sleeps under the frozen clock
process.env.FEE_WALLET = Keypair.generate().publicKey.toBase58();
process.env.FEE_BPS = "10";
delete process.env.CHAINALYSIS_API_KEY;

let now = Date.parse("2026-09-23T12:00:00Z");
Date.now = () => now;
const MINUTE = 60_000;

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const TESSERA_REFERRALS = "TESMgr3q4s1CK5nGz7bmkbMQBQeSt8N9wpZjTDWm2cY";
const DLMM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
const HOLDER = Keypair.generate().publicKey.toBase58(); // owner of every token account not in the pinned USDC list

const jupiter = await import("../src/lib/jupiter.ts");
const { getQuote, buildForUser, sendSigned, excludedDexesFor, USDC_TAKER_CANDIDATES } = jupiter;
const ownerByUsdcAta = new Map(
  USDC_TAKER_CANDIDATES.map((o) => [getAssociatedTokenAddressSync(new PublicKey(USDC), new PublicKey(o), true).toBase58(), o]),
);

function account(address) {
  return {
    lamports: 5_000_000_000,
    owner: SystemProgram.programId.toBase58(),
    data: {
      program: "spl-token",
      parsed: { type: "account", info: { owner: ownerByUsdcAta.get(address) ?? HOLDER, state: "initialized", tokenAmount: { amount: "100000000000" } } },
    },
  };
}

function build(url) {
  const q = new URL(url).searchParams;
  const inputMint = q.get("inputMint");
  const outputMint = q.get("outputMint");
  const amount = q.get("amount");
  return {
    inputMint,
    outputMint,
    inAmount: amount,
    outAmount: "1000000000",
    otherAmountThreshold: "990000000",
    slippageBps: 100,
    priceImpactPct: "0",
    routePlan: [{ percent: 100, swapInfo: { ammKey: DLMM, label: "Meteora DLMM", inputMint, outputMint, inAmount: amount, outAmount: "1000000000" } }],
    swapInstruction: { programId: JUP6, accounts: [], data: "" },
    blockhashWithMetadata: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 },
  };
}

let sent = 0;
let simMode = "revert"; // "shortpay": simulations succeed and the payer's output account gains 0.99x the quote
const buildUrls = [];
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
  if (url.startsWith("https://mainnet.helius-rpc.com/")) {
    const { method, params } = JSON.parse(init.body);
    if (method === "getMultipleAccounts") return Response.json({ result: { value: params[0].map(account) } });
    if (method === "getTokenLargestAccounts") return Response.json({ result: { value: [{ address: Keypair.generate().publicKey.toBase58(), amount: "100000000000" }] } });
    if (method === "getLatestBlockhash") return Response.json({ result: { value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 } } });
    if (method === "simulateTransaction" && simMode === "shortpay") {
      // Watched accounts are [input, output, fee]; every pre-read saw 100,000,000,000, and the quote is 1,000,000,000.
      const amounts = ["99000000000", "100990000000", "100001000000"];
      const accounts = amounts.map((amount) => ({ lamports: 2_039_280, owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", data: { program: "spl-token-2022", parsed: { type: "account", info: { tokenAmount: { amount } } } } }));
      return Response.json({ result: { context: { slot: 1 }, value: { err: null, logs: [], unitsConsumed: 50_000, accounts } } });
    }
    // Every simulation reverts inside Meteora DLMM, the way a taker's own token account can make it revert.
    if (method === "simulateTransaction") {
      const logs = [`Program ${JUP6} invoke [1]`, `Program ${DLMM} invoke [2]`, `Program ${DLMM} failed: custom program error: 0x1`, `Program ${JUP6} failed: custom program error: 0x1`];
      return Response.json({ result: { context: { slot: 1 }, value: { err: { InstructionError: [1, { Custom: 1 }] }, logs, unitsConsumed: 50_000 } } });
    }
    if (method === "sendTransaction") {
      sent++;
      return Response.json({ result: "5ig" });
    }
    if (method === "getSignatureStatuses") return Response.json({ result: { value: [{ slot: 2, err: null, confirmationStatus: "confirmed" }] } });
    if (method === "getTransaction") return Response.json({ result: null });
    throw new TypeError(`unstubbed rpc ${method}`);
  }
  if (url.includes("/swap/v2/program-id-to-label")) return Response.json({});
  if (url.includes("/swap/v2/order")) return Response.json({ outAmount: "1000000000", routePlan: [] });
  if (url.includes("/swap/v2/build")) {
    buildUrls.push(url);
    return Response.json(build(url));
  }
  throw new TypeError("offline"); // the sanctions APIs are unreachable, so only the local SDN list decides
};

const TKALSHI = "TKLSidmLVt3cqGaaodG8tyRzoANfQwoh67AccjmubeZ";
const TSPACEX = "TSPXcLV76s6V2zDiZQ18kBfcbnjaE2ZzNT3ga2Pd99v";
const TOPENAI = "oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ";
const PRE_SPACEX = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const PRE_OPENAI = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
const PRE_KALSHI = "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua";
const PRE_ANTHROPIC = "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw";

test("a caller's own wallet reverting twice a minute apart on /api/quote excludes nothing", async () => {
  const taker = Keypair.generate().publicKey.toBase58();
  const first = await getQuote({ mint: TKALSHI, side: "buy", amountRaw: "1000000000", taker });
  assert.equal(first.takerIsPlaceholder, false);
  now += 2 * MINUTE;
  await getQuote({ mint: TKALSHI, side: "buy", amountRaw: "1000000000", taker });
  assert.deepEqual(excludedDexesFor(TKALSHI), []);
});

test("the same wallet on /api/build's path excludes nothing", async () => {
  const taker = Keypair.generate().publicKey.toBase58();
  for (let i = 0; i < 2; i++) {
    await assert.rejects(buildForUser({ mint: TSPACEX, side: "buy", amountRaw: "1000000000", taker }), /thin at this size/);
    now += 2 * MINUTE;
  }
  assert.deepEqual(excludedDexesFor(TSPACEX), []);
});

test("a sell quote on the discovered placeholder (the mint's largest holder) excludes nothing", async () => {
  const first = await getQuote({ mint: PRE_SPACEX, side: "sell", amountRaw: "1000000000" });
  assert.equal(first.takerIsPlaceholder, true);
  assert.equal(first.takerUsed, HOLDER);
  now += 2 * MINUTE;
  await getQuote({ mint: PRE_SPACEX, side: "sell", amountRaw: "1000000000" });
  assert.deepEqual(excludedDexesFor(PRE_SPACEX), []);
});

test("a buy quote on a pinned USDC placeholder reverting twice a minute apart still excludes the leg", async () => {
  const first = await getQuote({ mint: TOPENAI, side: "buy", amountRaw: "1000000000" });
  assert.ok(USDC_TAKER_CANDIDATES.includes(first.takerUsed));
  now += 2 * MINUTE;
  await getQuote({ mint: TOPENAI, side: "buy", amountRaw: "1000000000" });
  assert.deepEqual(excludedDexesFor(TOPENAI), ["Meteora DLMM"]);
});

// Delivery is post minus pre on the payer's own account, so a payer can fake a short-pay by moving tokens out between
// the two reads (or a good delivery by moving them in).
test("a caller's own wallet measuring a short-pay on /api/quote excludes nothing", async () => {
  simMode = "shortpay";
  try {
    const taker = Keypair.generate().publicKey.toBase58();
    const q = await getQuote({ mint: PRE_OPENAI, side: "buy", amountRaw: "1000000000", taker });
    assert.equal(q.deliveryRatio, 0.99);
    assert.deepEqual(excludedDexesFor(PRE_OPENAI), []);
  } finally {
    simMode = "revert";
  }
});

test("a user's build routes around a short-pay for that build only", async () => {
  simMode = "shortpay";
  try {
    const taker = Keypair.generate().publicKey.toBase58();
    const from = buildUrls.length;
    const built = await buildForUser({ mint: PRE_KALSHI, side: "buy", amountRaw: "1000000000", taker });
    assert.ok(built.transactionBase64);
    assert.ok(buildUrls.slice(from).some((u) => new URL(u).searchParams.get("excludeDexes")?.split(",").includes("Meteora DLMM")));
    assert.deepEqual(excludedDexesFor(PRE_KALSHI), []);
  } finally {
    simMode = "revert";
  }
});

test("a pinned USDC placeholder measuring a short-pay still excludes the leg", async () => {
  simMode = "shortpay";
  try {
    const q = await getQuote({ mint: PRE_ANTHROPIC, side: "buy", amountRaw: "1000000000" });
    assert.ok(USDC_TAKER_CANDIDATES.includes(q.takerUsed));
    assert.deepEqual(excludedDexesFor(PRE_ANTHROPIC), ["Meteora DLMM"]);
  } finally {
    simMode = "revert";
  }
});

// A v0 transaction with one instruction to `programId`, paid by `payer`. sendSigned checks that the payer signature is
// present, not that it verifies (the RPC does that), so a filler signature stands in for keys we do not hold.
function signedBy(payer, programId) {
  const ix = new TransactionInstruction({ programId: new PublicKey(programId), keys: [], data: Buffer.alloc(0) });
  const msg = new TransactionMessage({ payerKey: new PublicKey(payer), recentBlockhash: "11111111111111111111111111111111", instructions: [ix] }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.signatures[0] = new Uint8Array(64).fill(1);
  return Buffer.from(tx.serialize()).toString("base64");
}

test("/api/send refuses a transaction to neither the Jupiter nor the Tessera referral program, and sends nothing", async () => {
  const before = sent;
  await assert.rejects(sendSigned(signedBy(Keypair.generate().publicKey.toBase58(), SystemProgram.programId.toBase58())), (e) => e.status === 400);
  assert.equal(sent, before);
});

test("/api/send refuses a payer on the OFAC SDN list", async () => {
  const listed = JSON.parse(readFileSync(new URL("../src/lib/data/sdn-solana.json", import.meta.url), "utf8")).sol[0];
  const before = sent;
  await assert.rejects(sendSigned(signedBy(listed, JUP6)), (e) => e.status === 403);
  assert.equal(sent, before);
});

test("/api/send relays a Jupiter swap and a Tessera registration from a clean payer", async () => {
  const before = sent;
  const swap = await sendSigned(signedBy(Keypair.generate().publicKey.toBase58(), JUP6));
  assert.equal(swap.status, "confirmed");
  const registration = await sendSigned(signedBy(Keypair.generate().publicKey.toBase58(), TESSERA_REFERRALS));
  assert.equal(registration.status, "confirmed");
  assert.equal(sent, before + 2);
});
