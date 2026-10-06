// Registry invariants for src/lib/registry.ts after the 2026-10-06 additions (27 companies and 30 wrappers from the
// verified table; 8 rows flagged market: "none"). Every expected value below is typed by hand from that table.
// Run: node --test scripts/test-registry.mjs

import test from "node:test";
import assert from "node:assert/strict";
import bs58 from "bs58";

// No resolve hook: registry.ts has only `import type`, which Node strips.
const { companies, wrappers, companyById, listedWrappersForCompany } = await import("../src/lib/registry.ts");

const NO_MARKET = ["AAPL.US", "TSLA.US", "NVDA.US", "SPY.US", "AAPLon", "TSLAon", "NVDAon", "SPYon"];
const DECIMALS = { xstocks: 8, ondo: 9, backpack: 6, tessera: 9, prestocks: 9 };

test("43 companies and 60 wrappers, 8 of them with no market", () => {
  assert.equal(companies.length, 43);
  assert.equal(wrappers.length, 60);
  assert.equal(wrappers.filter((w) => w.market === "none").length, 8);
});

test("every mint is a unique 32-byte base58 key", () => {
  for (const w of wrappers) assert.equal(bs58.decode(w.mint).length, 32, w.symbol);
  assert.equal(new Set(wrappers.map((w) => w.mint)).size, 60);
});

test("every wrapper's companyId exists and company ids are unique", () => {
  for (const w of wrappers) assert.ok(companyById.has(w.companyId), `${w.symbol} -> ${w.companyId}`);
  assert.equal(companyById.size, 43);
});

test("decimals follow the issuer norm", () => {
  for (const w of wrappers) assert.equal(w.decimals, DECIMALS[w.issuer], w.symbol);
  // 6 + 17 xstocks, 4 ondo, 9 + 13 backpack, 3 tessera, 8 prestocks
  const byIssuer = {};
  for (const w of wrappers) byIssuer[w.issuer] = (byIssuer[w.issuer] ?? 0) + 1;
  assert.deepEqual(byIssuer, { xstocks: 23, ondo: 4, backpack: 22, tessera: 3, prestocks: 8 });
});

test("every backpack-external symbol ends in .US_USDC", () => {
  const bx = wrappers.filter((w) => w.reference.kind === "backpack-external");
  for (const w of bx) assert.match(w.reference.symbol, /\.US_USDC$/, w.symbol);
  assert.equal(bx.length, 24); // SPCX.US, FWDI.US, DJT.US, BOT.US + 10 xStocks + 10 Backpack rows from the table
});

test("every pyth-core feed id is 64 hex chars", () => {
  const pc = wrappers.filter((w) => w.reference.kind === "pyth-core");
  for (const w of pc) assert.match(w.reference.feedId, /^[0-9a-f]{64}$/, w.symbol);
  assert.equal(pc.length, 24); // 14 before + QQQx, MSTRx, GOOGLx, METAx, MSFTx, AMZNx, INTCx, MSTR.US, SNDK.US, INTC.US
  const fed = companies.filter((c) => c.pythEquityFeedId);
  for (const c of fed) assert.match(c.pythEquityFeedId, /^[0-9a-f]{64}$/, c.id);
  assert.equal(fed.length, 31); // 5 before + every added company but pusa
});

test("the no-market rows are exactly the 8 retired symbols", () => {
  assert.deepEqual(wrappers.filter((w) => w.market === "none").map((w) => w.symbol).sort(), [...NO_MARKET].sort());
});

test("listedWrappersForCompany drops the flagged rows and nothing else", () => {
  const listed = companies.flatMap((c) => listedWrappersForCompany(c.id));
  assert.equal(listed.length, 52);
  assert.deepEqual(listedWrappersForCompany("aapl").map((w) => w.symbol), ["AAPLx"]);
  assert.deepEqual(listedWrappersForCompany("mstr").map((w) => w.symbol), ["MSTRx", "MSTR.US"]);
});
