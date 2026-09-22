// Verify the Jupiter module against mainnet: quotes, simulations, fee account deltas, delivery ratios, the /order
// comparison, and the Manifest short-pay catch. Nothing is broadcast; every transaction is simulateTransaction only.
//
// Run: cd /home/rizki/projects/par && node --env-file=.env.local scripts/verify-jupiter.mjs
// Optional: PAR_BASE_URL=http://localhost:3000 also calls GET /api/quote on a running dev server.
//
// The script loads the real src/lib/jupiter.ts through Node's type stripping. Only "@/lib/screening" is stubbed
// (getQuote never screens; buildForUser does, and runs here once with a funded pinned wallet as the taker, so the
// stub is what lets that call through).

import { registerHooks } from "node:module";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// package.json has no "type" field; Node warns once per stripped .ts file it has to re-parse as ESM. Keep other warnings.
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.code !== "MODULE_TYPELESS_PACKAGE_JSON") console.warn(`${w.name}: ${w.message}`);
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");
const srcUrl = pathToFileURL(src + path.sep).href;
const SCREENING_STUB = "data:text/javascript,export const screenAddress = async () => ({ blocked: false });";

function tsFile(p) {
  if (existsSync(p) && statSync(p).isFile()) return p;
  for (const ext of [".ts", ".tsx", ".mts"]) if (existsSync(p + ext)) return p + ext;
  const idx = path.join(p, "index.ts");
  return existsSync(idx) ? idx : null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/screening") return { url: SCREENING_STUB, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const f = tsFile(path.join(src, specifier.slice(2)));
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith(srcUrl)) {
      const f = tsFile(fileURLToPath(new URL(specifier, context.parentURL)));
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const jup = await import("../src/lib/jupiter.ts");
const { wrapperByMint } = await import("../src/lib/registry.ts");
const { getQuote, feeAccount, feeBps, excludedDexesFor, viableUsdcTakers, buildForUser, JupiterError } = jup;

for (const k of ["HELIUS_API_KEY", "FEE_WALLET", "FEE_BPS"]) {
  if (!process.env[k]) {
    console.error(`${k} is not set; run with node --env-file=.env.local`);
    process.exit(2);
  }
}

const TARGETS = [
  { name: "tOpenAI (Tessera)", mint: "oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ" },
  { name: "OPENAI (PreStocks)", mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF" },
  { name: "AAPLx (xStocks)", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" },
  { name: "SPCX.US (Backpack)", mint: "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb" },
];
const BUY_USDC_RAW = "1000000";
const bps = feeBps();
const feeAta = feeAccount().toBase58();
let checks = 0;
let failures = 0;

function check(label, ok, detail) {
  checks++;
  if (!ok) failures++;
  console.log(`   ${ok ? "OK  " : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
}
const units = (raw, dec) => (Number(raw) / 10 ** dec).toFixed(dec > 6 ? 6 : dec);
const n = (x) => (x === undefined ? "n/a" : String(x));

function printQuote(title, r, outDecimals) {
  const inDec = r.side === "buy" ? 6 : outDecimals;
  const outDec = r.side === "buy" ? outDecimals : 6;
  console.log(`\n== ${title}`);
  console.log(`   taker ${r.takerUsed}${r.takerIsPlaceholder ? " (placeholder, largest system-owned holder of the input mint)" : ""}`);
  console.log(`   route ${r.routeLabels.join(" + ") || "none"} | slippage ${r.slippageBps} bps | price impact ${(r.priceImpactPct * 100).toFixed(4)}% | excluded for mint [${r.excludedDexes.join(", ")}]`);
  console.log(`   in         ${r.inAmountRaw} raw (${units(r.inAmountRaw, inDec)})`);
  console.log(`   quoted out ${r.outAmountRaw} raw (${units(r.outAmountRaw, outDec)}), net of the ${r.feeBps} bps app fee`);
  console.log(`   simulated  ${n(r.simulatedOutRaw)} raw | ratio ${r.deliveryRatio === undefined ? "n/a" : r.deliveryRatio.toFixed(6)} | cu ${n(r.computeUnits)} | ran ${r.simulationRan}`);
  console.log(`   expected   ${r.expectedRaw} raw | minimum ${r.minimumRaw} raw (otherAmountThreshold)`);
  console.log(`   fee acct   ${feeAta} delta ${n(r.simulatedFeeRaw)} raw USDC | feeAmountRaw ${r.feeAmountRaw}`);
  console.log(`   /order     ${n(r.jupOrderOutRaw)} raw at ${n(r.jupOrderFeeBps)} bps${r.jupOrderStale ? ` (last good, ${r.jupOrderAgeSec} s old)` : ""}`);
  if (r.jupOrderOutRaw && r.expectedRaw !== "0") {
    const diff = BigInt(r.expectedRaw) - BigInt(r.jupOrderOutRaw);
    const diffBps = Number((diff * 10000n) / BigInt(r.jupOrderOutRaw));
    console.log(`   compare    ours minus jup.ag /order: ${diff} raw (${diffBps} bps of jup.ag)`);
  }
  if (r.reason) console.log(`   reason     ${r.reason}`);
  if (r.steps) for (const s of r.steps) console.log(`   step       ${s}`);
}

console.log(`Fee wallet USDC ATA ${feeAta}, FEE_BPS ${bps}, Jupiter key ${process.env.JUPITER_API_KEY ? "set" : "absent (keyless pacing 5 per 11 s)"}`);
console.log(`Screening stubbed for this script. Nothing is broadcast.`);
const t0 = Date.now();

// USDC placeholder takers for buy-side label quotes: the pinned list first, then the keyless fallback pickTaker uses
// when the list is dry (owners of every registry wrapper's largest token accounts that also hold USDC). Both are read
// live. Check an owner on Solscan: system-owned, at least 0.01 SOL, USDC balance as printed.
console.log(`\n== USDC placeholder taker pool`);
const pinnedTakers = await viableUsdcTakers("pinned");
for (const c of pinnedTakers) console.log(`   pinned     ${c.owner}  ${units(c.amount, 6)} USDC`);
check("pinned USDC takers viable (system-owned, >= 0.01 SOL, USDC > 0) >= 3", pinnedTakers.length >= 3, `${pinnedTakers.length} of 5`);
{
  const t1 = Date.now();
  const discovered = await viableUsdcTakers("discovered");
  for (const c of discovered.slice(0, 5)) console.log(`   discovered ${c.owner}  ${units(c.amount, 6)} USDC`);
  check("fallback discovery through the wrappers' largest holders finds >= 1 viable USDC wallet", discovered.length >= 1, `${discovered.length} found in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
}

for (const t of TARGETS) {
  const w = wrapperByMint.get(t.mint);
  const dec = w.decimals;
  let buy;
  try {
    buy = await getQuote({ mint: t.mint, side: "buy", amountRaw: BUY_USDC_RAW });
  } catch (e) {
    console.log(`\n== BUY ${t.name}: ${e.message}`);
    check(`${t.name} buy quote returned`, false, e.message);
    continue;
  }
  printQuote(`BUY ${t.name} with ${units(BUY_USDC_RAW, 6)} USDC`, buy, dec);
  check(`${t.name} buy simulated`, buy.simulationRan, buy.reason);
  if (buy.simulationRan) {
    const expectedFee = (BigInt(BUY_USDC_RAW) * BigInt(bps)) / 10000n;
    check(`${t.name} buy fee account delta equals amount x FEE_BPS / 10000`, buy.simulatedFeeRaw === expectedFee.toString(), `${buy.simulatedFeeRaw} vs ${expectedFee}`);
    check(`${t.name} buy delivery ratio >= 0.999`, buy.deliveryRatio >= 0.999, buy.deliveryRatio?.toFixed(6));
    check(`${t.name} buy expected <= quoted`, BigInt(buy.expectedRaw) <= BigInt(buy.outAmountRaw));
    check(`${t.name} buy minimum <= expected`, BigInt(buy.minimumRaw) <= BigInt(buy.expectedRaw), `${buy.minimumRaw} <= ${buy.expectedRaw}`);
  }

  if (buy.expectedRaw === "0") continue;
  let sell;
  try {
    sell = await getQuote({ mint: t.mint, side: "sell", amountRaw: buy.expectedRaw });
  } catch (e) {
    console.log(`\n== SELL ${t.name}: ${e.message}`);
    check(`${t.name} sell quote returned`, false, e.message);
    continue;
  }
  printQuote(`SELL ${t.name}: the ${units(buy.expectedRaw, dec)} received above`, sell, dec);
  check(`${t.name} sell simulated`, sell.simulationRan, sell.reason);
  if (sell.simulationRan) {
    const fee = BigInt(sell.simulatedFeeRaw ?? "0");
    const gross = BigInt(sell.outAmountRaw) + fee;
    const feeBpsMeasured = gross > 0n ? Number((fee * 1000000n) / gross) / 100 : 0;
    check(`${t.name} sell fee taken from USDC output at FEE_BPS`, Math.abs(feeBpsMeasured - bps) < 0.5, `${fee} raw of ${gross} gross = ${feeBpsMeasured.toFixed(2)} bps`);
    check(`${t.name} sell delivery ratio >= 0.999`, sell.deliveryRatio >= 0.999, sell.deliveryRatio?.toFixed(6));
    const roundTrip = Number(BUY_USDC_RAW) - Number(sell.expectedRaw);
    console.log(`   round trip ${units(BUY_USDC_RAW, 6)} USDC in, ${units(sell.expectedRaw, 6)} USDC back: cost ${(roundTrip / 1e6).toFixed(6)} USDC (${((roundTrip / Number(BUY_USDC_RAW)) * 100).toFixed(3)}%)`);
  }
}

// Force a Manifest route on PreStocks OPENAI. Manifest's adapter ignores the transfer fee, so the module must decline
// it: measure the short-pay and exclude Manifest for the mint, report the simulation revert, or find no route.
{
  const pre = TARGETS[1];
  console.log(`\n== FORCED dexes=Manifest on ${pre.name} (short-pay check)`);
  try {
    const forced = await getQuote({ mint: pre.mint, side: "buy", amountRaw: BUY_USDC_RAW, dexes: ["Manifest"] });
    printQuote(`BUY ${pre.name} via Manifest only`, forced, 9);
    const ratio = forced.deliveryRatio;
    const excluded = excludedDexesFor(pre.mint);
    const caught = (ratio !== undefined && ratio < 0.999 && excluded.includes("Manifest")) || (!forced.simulationRan && forced.reason?.startsWith("no route simulated"));
    check(`Manifest declined (ratio ${ratio === undefined ? "n/a" : ratio.toFixed(6)}; excluded now [${excluded.join(", ")}])`, caught, forced.reason);
    if (forced.simulationRan) check(`Manifest delivered about 0.995x`, ratio > 0.99 && ratio < 0.999, ratio.toFixed(6));
  } catch (e) {
    check(`Manifest declined: no route`, /No routes found/.test(e.message), e.message);
  }
}

// buildForUser, the real-taker path. A fresh keypair holds no USDC: the refusal must come from the balance read,
// with structured details, before any /build call. Then the largest pinned wallet builds a real unsigned transaction:
// sizing pass at 1.4M CU, limit at 1.2x units used, final simulation. Nothing is signed or broadcast.
{
  console.log(`\n== buildForUser`);
  const empty = Keypair.generate().publicKey.toBase58();
  try {
    await buildForUser({ mint: TARGETS[0].mint, side: "buy", amountRaw: BUY_USDC_RAW, taker: empty });
    check("empty taker refused before /build", false, "no error thrown");
  } catch (e) {
    const ok = e instanceof JupiterError && e.code === "insufficient_balance" && e.status === 400 && e.details?.haveRaw === "0" && e.details?.needRaw === BUY_USDC_RAW;
    check(`empty taker ${empty} refused from the balance read`, ok, `${e.code ?? e.name} ${e.status ?? ""} details ${JSON.stringify(e.details)}`);
  }
  if (pinnedTakers.length) {
    const taker = pinnedTakers[0].owner;
    try {
      const b = await buildForUser({ mint: TARGETS[0].mint, side: "buy", amountRaw: BUY_USDC_RAW, taker });
      console.log(`   taker ${taker} | route ${b.routeLabels.join(" + ")} | slippage ${b.slippageBps} bps`);
      console.log(`   quoted ${b.outAmountRaw} simulated ${b.simulatedOutRaw} ratio ${b.deliveryRatio.toFixed(6)} | expected ${b.expectedRaw} minimum ${b.minimumRaw}`);
      console.log(`   cu used ${b.computeUnitsUsed} limit ${b.computeUnitLimit} | fee ${b.feeAmountRaw} raw USDC to ${b.feeAccount}`);
      console.log(`   blockhash ${b.blockhash} valid to height ${b.lastValidBlockHeight} | tx ${b.transactionBase64.length} chars base64`);
      const tx = VersionedTransaction.deserialize(Buffer.from(b.transactionBase64, "base64"));
      check("returned transaction is unsigned and pays from the taker", tx.signatures.every((s) => s.every((x) => x === 0)) && tx.message.staticAccountKeys[0].toBase58() === taker);
      check("buildForUser fee equals amount x FEE_BPS / 10000", b.feeAmountRaw === ((BigInt(BUY_USDC_RAW) * BigInt(bps)) / 10000n).toString(), b.feeAmountRaw);
      check("compute unit limit covers units used and stays under 1.4M", b.computeUnitLimit >= b.computeUnitsUsed && b.computeUnitLimit <= 1400000, `${b.computeUnitsUsed} used, limit ${b.computeUnitLimit}`);
      check("buildForUser delivery ratio >= 0.999", b.deliveryRatio >= 0.999, b.deliveryRatio.toFixed(6));
    } catch (e) {
      check("buildForUser with the largest pinned wallet as taker", false, e.message);
    }
  }
}

if (process.env.PAR_BASE_URL) {
  const url = `${process.env.PAR_BASE_URL}/api/quote?mint=${TARGETS[0].mint}&side=buy&amount=${BUY_USDC_RAW}`;
  console.log(`\n== GET ${url}`);
  try {
    const r = await fetch(url);
    const j = await r.json();
    console.log(`   HTTP ${r.status} expected ${j.expectedRaw} minimum ${j.minimumRaw} route ${(j.routeLabels || []).join("+")} compare ${JSON.stringify(j.compare)}`);
    check("/api/quote answered 200", r.status === 200, j.error);
  } catch (e) {
    check("/api/quote reachable", false, e.message);
  }
}

console.log(`\n${checks - failures}/${checks} checks passed in ${((Date.now() - t0) / 1000).toFixed(0)} s. Nothing was broadcast.`);
process.exit(failures ? 1 : 0);
