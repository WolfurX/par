// Verify src/lib/reference.ts and src/lib/pyth-core.ts against the live sources.
// Run: cd /home/rizki/projects/par && node --env-file=.env.local scripts/verify-reference.mjs
//
// Nothing here writes to a chain. Every number printed has a URL or an account address beside it so it
// can be checked by hand against the issuer.

// src/lib uses extensionless imports (Next resolves them); node needs the extension, so add a hook.
import { register } from "node:module";
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(spec, ctx, next) {" +
        "  try { return await next(spec, ctx); } catch (e) {" +
        "    if (spec.startsWith('.') && !/\\.[cm]?[jt]sx?$/.test(spec)) return next(spec + '.ts', ctx);" +
        "    throw e; } }",
    ),
);

const { getReference, referenceChain, getPythIndex, getPythProPrice } = await import("../src/lib/reference.ts");
const { pythPriceAccount, readPythCoreOne, PYTH_RECEIVER_PROGRAM } = await import("../src/lib/pyth-core.ts");
const { companyById, wrappers, PYTH_CORE_SHARD } = await import("../src/lib/registry.ts");
const { fmtAge } = await import("../src/lib/units.ts");

const bySymbol = (sym) => wrappers.find((w) => w.symbol === sym);

const targets = [
  { symbol: "tOpenAI", expect: "Tessera auction mark, about 812.79 (app.tessera.pe 'Auction Price')" },
  { symbol: "OPENAI", expect: "PreStocks markPrice, about 965 on 2026-09-16" },
  { symbol: "AAPLx", expect: "Pyth Core on-chain account, about 334.82, verification full" },
  { symbol: "SPCX.US", expect: "Backpack consolidated US price, about 145 to 155" },
  { symbol: "SPCXx", expect: "xStocks quote is null outside trading hours, so the fallback path should show" },
  // SpaceX listed in June 2026, so its Company record is public. These two wrappers are still pre-IPO
  // instruments (Tessera loan participation, PreStocks SPV) and must have a one-source chain anyway.
  { symbol: "tSpaceX", expect: "Tessera mark only; chain must be one entry, no SPCX equity fallback" },
  { symbol: "SPACEX", expect: "PreStocks mark only; chain must be one entry, no SPCX equity fallback" },
];

// A pre-IPO wrapper must never carry a fallback rung, whatever its company's kind is.
const PRE_IPO_SOURCES = new Set(["tessera", "prestocks"]);

const iso = (t) => new Date(t * 1000).toISOString().replace(".000Z", "Z");

console.log(`now ${iso(Math.floor(Date.now() / 1000))}  PYTH_PRO_API_KEY ${process.env.PYTH_PRO_API_KEY ? "set" : "not set"}\n`);

// --- 1. pyth-core: PDA derivation and PriceUpdateV2 parse ----------------------------------------

const aapl = companyById.get("aapl");
const aaplAccount = pythPriceAccount(aapl.pythEquityFeedId, PYTH_CORE_SHARD);
console.log("=== Pyth Core account (keyless, any RPC) ===");
console.log(`  feed id:      ${aapl.pythEquityFeedId} (Equity.US.AAPL/USD)`);
console.log(`  shard:        ${PYTH_CORE_SHARD}`);
console.log(`  derived PDA:  ${aaplAccount.toBase58()}`);
console.log(`  expected PDA: D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW`);
console.log(`  match:        ${aaplAccount.toBase58() === "D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW"}`);
console.log(`  owner must be ${PYTH_RECEIVER_PROGRAM}`);
const core = await readPythCoreOne(aapl.pythEquityFeedId);
if (!core) {
  console.log("  read:         NO ACCOUNT");
} else {
  console.log(`  price:        ${core.price}  (mantissa x 10^${core.exponent})`);
  console.log(`  conf:         ${core.conf}`);
  console.log(`  ema:          ${core.emaPrice}`);
  console.log(`  verification: ${core.verification}${core.numSignatures ? ` (${core.numSignatures} signatures)` : ""}`);
  console.log(`  publishTime:  ${core.publishTime} = ${iso(core.publishTime)}  (${fmtAge(Math.floor(Date.now() / 1000) - core.publishTime)})`);
  console.log(`  postedSlot:   ${core.postedSlot}`);
  console.log(`  check:        https://solscan.io/account/${core.account}`);
}
console.log();

// --- 2. the ladder per wrapper --------------------------------------------------------------------

for (const t of targets) {
  const w = bySymbol(t.symbol);
  if (!w) {
    console.log(`=== ${t.symbol} === registry has no wrapper with this symbol\n`);
    continue;
  }
  const c = companyById.get(w.companyId);
  const chain = referenceChain(w, c);
  console.log(`=== ${w.symbol} (${w.issuer}, ${c.name}, ${c.kind}) ===`);
  console.log(`  mint:      ${w.mint}`);
  console.log(`  expected:  ${t.expect}`);
  console.log(`  chain:     ${chain.join(" -> ")}`);
  if (PRE_IPO_SOURCES.has(w.reference.kind)) {
    console.log(`  no-ladder: ${chain.length === 1 ? "OK, single source" : `BROKEN, ${chain.length} sources`}`);
  }
  const start = Date.now();
  try {
    const r = await getReference(w, c);
    const servedBy = chain.find((k) => sourceMatchesKey(r.source, k)) ?? "(see source)";
    console.log(`  price:     ${r.price} ${r.currency}`);
    console.log(`  source:    ${r.source}`);
    console.log(`  served by: ${servedBy}${servedBy === chain[0] ? "" : "   <- fell back"}`);
    console.log(`  sourceUrl: ${r.sourceUrl ?? "(none: key-gated feed)"}`);
    console.log(`  asOf:      ${r.asOf} = ${iso(r.asOf)}`);
    console.log(`  age:       ${r.ageSec} s (${fmtAge(r.ageSec)})`);
    console.log(`  stale:     ${r.stale}    pythMark: ${r.pythMark === true}`);
    console.log(`  took:      ${Date.now() - start} ms`);
  } catch (e) {
    console.log(`  FAILED:    ${e.message}`);
  }
  console.log();
}

// Map a human source label back to the chain key that produced it, so the fallback path is visible.
function sourceMatchesKey(source, key) {
  const [kind, arg] = key.split(":");
  if (kind === "pyth-core") return source.startsWith("Pyth Core");
  if (kind === "pyth-pro") return source.includes(`Pyth Pro feed ${arg}`);
  if (kind === "backpack") return source.includes(arg);
  if (kind === "tessera") return source.startsWith("Tessera") && source.includes(arg);
  if (kind === "prestocks") return source.startsWith("PreStocks") && source.includes(arg);
  if (kind === "xstocks") return source.startsWith("xStocks") && source.includes(arg);
  return false;
}

// --- 3. fallback path, forced ---------------------------------------------------------------------
// AAPLx with its reference rewritten to the xStocks quote. Outside US trading hours that endpoint
// answers {"quote":null}, so the row must fall through to the next rung of the ladder.

{
  const base = bySymbol("AAPLx");
  const w = { ...base, reference: { kind: "xstocks-price-data", symbol: "AAPLx" } };
  const c = companyById.get(w.companyId);
  const chain = referenceChain(w, c);
  console.log("=== AAPLx with the xStocks quote as primary (constructed, not in the registry) ===");
  console.log(`  chain:     ${chain.join(" -> ")}`);
  try {
    const r = await getReference(w, c);
    const servedBy = chain.find((k) => sourceMatchesKey(r.source, k)) ?? "(see source)";
    console.log(`  price:     ${r.price} ${r.currency}`);
    console.log(`  served by: ${servedBy}${servedBy === chain[0] ? "" : "   <- fell back from " + chain[0]}`);
    console.log(`  source:    ${r.source}`);
    console.log(`  age:       ${r.ageSec} s (${fmtAge(r.ageSec)})   stale: ${r.stale}`);
  } catch (e) {
    console.log(`  FAILED:    ${e.message}`);
  }
  console.log();
}

// --- 4. circuit breaker ----------------------------------------------------------------------------
// A private company with one unreachable source: no ladder to fall through, so the failures are visible.
// The guarantee is THREE REAL upstream failures. A cooldown rejection is not a call to the upstream, so
// it must not count. Backpack's cooldown is 15 s, so real failures are spaced out with a wait.

{
  const w = { ...bySymbol("tOpenAI"), symbol: "BREAKERTEST", reference: { kind: "backpack-external", symbol: "NOSUCH.US_USDC" } };
  const c = { id: "breakertest", name: "Breaker test", kind: "private" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const classify = (m) => (m.includes("breaker open") ? "breaker open" : m.includes("cooldown") ? "cooldown, no upstream call" : "real upstream failure");
  console.log("=== circuit breaker (3 REAL failures then 60 s of last-good or refusal) ===");
  const call = async (i, note) => {
    const t = Date.now();
    try {
      await getReference(w, c);
      console.log(`  call ${i}: unexpected success`);
      return "success";
    } catch (e) {
      const kind = classify(e.message);
      console.log(`  call ${i}: ${String(Date.now() - t).padStart(5)} ms  ${kind.padEnd(26)} ${note}`);
      return kind;
    }
  };
  const seen = [];
  seen.push(await call(1, "real failure 1"));
  seen.push(await call(2, "must not count"));
  seen.push(await call(3, "must not count"));
  await sleep(15500);
  seen.push(await call(4, "real failure 2, breaker must still be closed"));
  await sleep(15500);
  seen.push(await call(5, "real failure 3, breaker opens on this one"));
  seen.push(await call(6, "no upstream call, breaker is open"));
  const realFailures = [1, 4, 5].every((i) => seen[i - 1] === "real upstream failure");
  const cooldownsIgnored = seen[1] === "cooldown, no upstream call" && seen[2] === "cooldown, no upstream call" && seen[3] !== "breaker open";
  console.log(`  three-strikes honoured: ${realFailures && cooldownsIgnored && seen[5] === "breaker open" ? "OK" : "BROKEN"}`);
  console.log("  (calls 2 and 3 are cooldown rejections; if they counted, call 4 would already say 'breaker open')");
  console.log();
}

// --- 5. Pyth Pro side feeds -----------------------------------------------------------------------

console.log("=== Pyth Pro (key-gated; null is the expected result without an entitled key) ===");
const openai = companyById.get("openai");
const index = await getPythIndex(openai.pythIndexProId);
console.log(`  Pyth.Index.OPENAI/USD (feed ${openai.pythIndexProId}): ${index ? `${index.price} USD, ${fmtAge(index.ageSec)}` : "null"}`);
const aaplxWrapper = bySymbol("AAPLx");
const wrapperFeed = await getPythProPrice(aaplxWrapper.pythWrapperProId);
console.log(`  Crypto.AAPLX/USD (feed ${aaplxWrapper.pythWrapperProId}):        ${wrapperFeed ? `${wrapperFeed.price} USD` : "null"}`);
const rr = await getPythProPrice(aaplxWrapper.pythRedemptionRateProId);
console.log(`  Crypto.AAPLX/AAPL.RR (feed ${aaplxWrapper.pythRedemptionRateProId}):    ${rr ? rr.price : "null"}`);
console.log();

// --- 6. cache behaviour ---------------------------------------------------------------------------

console.log("=== in-memory cache ===");
const t0 = Date.now();
const w = bySymbol("tOpenAI");
try {
  const again = await getReference(w, companyById.get(w.companyId));
  console.log(`  second tOpenAI read: ${Date.now() - t0} ms, age now ${again.ageSec} s, stale ${again.stale}`);
  console.log("  (age grows while the memo holds; a new upstream call only happens after the TTL)");
} catch (e) {
  console.log(`  second tOpenAI read: ${e.message}`);
  console.log("  (the first read failed too, so there is no last-good value to serve; Tessera returns 500 on about one call in seven)");
}
