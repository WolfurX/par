// Reproduces the reference-ladder defects fixed in src/lib/reference.ts: an open breaker skipping a
// healthy rung, ages stamped from our fetch instead of the price, and a cold instance with a closed
// market having no reference for a public name, and a Pyth Core account that stopped updating being
// served for days. No network: fetch and the clock are stubbed.
// Run: node --test scripts/test-reference.mjs

import test from "node:test";
import assert from "node:assert/strict";

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

delete process.env.PYTH_PRO_API_KEY;
delete process.env.HELIUS_API_KEY;
delete process.env.NEXT_PUBLIC_RPC_URL;

let now = Date.parse("2026-09-20T15:00:00Z");
Date.now = () => now;

// Live Pyth market_session_schedule for Equity.US.AAPL/USD, observed 2026-09-22.
const SCHEDULE = {
  regular:
    "America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;0907/C,1126/C,1127/0930-1300,1224/0930-1300,1225/C,0101/C,0118/C,0215/C,0326/C,0531/C,0618/C,0705/C",
  pre_market:
    "America/New_York;0400-0930,0400-0930,0400-0930,0400-0930,0400-0930,C,C;0907/C,1126/C,1225/C,0101/C,0118/C,0215/C,0326/C,0531/C,0618/C,0705/C",
  post_market:
    "America/New_York;1600-2000,1600-2000,1600-2000,1600-2000,1600-2000,C,C;0907/C,1126/C,1127/1300-1700,1224/1300-1700,1225/C,0101/C,0118/C,0215/C,0326/C,0531/C,0618/C,0705/C",
  over_night:
    "America/New_York;0000-0400&2000-2400,0000-0400&2000-2400,0000-0400&2000-2400,0000-0400&2000-2400,0000-0400,C,2000-2400;0906/C,0907/2000-2400,1125/0000-0400,1126/2000-2400,1224/0000-0400,1225/C,1231/0000-0400,0101/C,0117/C,0118/2000-2400,0214/C,0215/2000-2400,0325/0000-0400,0326/C,0530/C,0531/2000-2400,0617/0000-0400,0618/C,0704/C,0705/2000-2400",
};

// Live SPCX.US_USDC Backpack External klines observed 2026-09-22. Trading stops for the weekend after
// the bar ending 2026-09-19T00:00:00Z (Friday's post-market close); later bars are flat with trades "0".
const KLINES = [
  { start: "2026-09-18 22:00:00", end: "2026-09-18 23:00:00", open: "152.4603", close: "152.68", trades: "2005" },
  { start: "2026-09-18 23:00:00", end: "2026-09-19 00:00:00", open: "152.68", close: "152.6432", trades: "2620" },
  { start: "2026-09-19 00:00:00", end: "2026-09-19 01:00:00", open: "152.6432", close: "152.6432", trades: "0" },
  { start: "2026-09-20 14:00:00", end: "2026-09-20 15:00:00", open: "152.6432", close: "152.6432", trades: "0" },
  { start: "2026-09-20 15:00:00", end: "2026-09-20 16:00:00", open: "152.6432", close: "152.6432", trades: "0" },
];

let xstocksQuote = null;
let xstocksStatus = 200;
let xstocksCalls = 0;
let tickerBody = { symbol: "SPCX.US_USDC" };
let pythCore = { price: 0, publishTime: 0 };
let aaplTicker = "0";

const AAPL_FEED = "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";

// PriceUpdateV2 account data as src/lib/pyth-core.ts reads it: 8 discriminator, 32 write authority,
// verification tag at 40 (1 = full), feed id 41..72, price i64 at 73, conf u64 at 81, exponent i32 at 89,
// publish_time i64 at 93.
function priceUpdateV2(price, publishTime) {
  const b = Buffer.alloc(134);
  b[40] = 1;
  Buffer.from(AAPL_FEED, "hex").copy(b, 41);
  b.writeBigInt64LE(BigInt(Math.round(price * 1e5)), 73);
  b.writeInt32LE(-5, 89);
  b.writeBigInt64LE(BigInt(publishTime), 93);
  return b.toString("base64");
}

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith("https://history.pyth-lazer.dourolabs.app/history/v1/symbols")) {
    return new Response(JSON.stringify([{ symbol: "Equity.US.AAPL/USD", state: "stable", market_session_schedule: SCHEDULE }]), { status: 200 });
  }
  if (url.startsWith("https://api.xstocks.fi/api/v2/public/assets/SPCXx/price-data")) {
    xstocksCalls++;
    return new Response(JSON.stringify({ quote: xstocksQuote }), { status: xstocksStatus });
  }
  if (url.startsWith("https://api.backpack.exchange/api/v1/ticker?symbol=SPCX.US_USDC")) {
    return new Response(JSON.stringify(tickerBody), { status: 200 });
  }
  if (url.startsWith("https://api.backpack.exchange/api/v1/klines?symbol=SPCX.US_USDC")) {
    return new Response(JSON.stringify(KLINES), { status: 200 });
  }
  if (url.startsWith("https://rest-api.tessera.pe/v1/public/token-details")) {
    return new Response(JSON.stringify([{ code: "tSpaceX", markPrice: 423 }]), { status: 200 });
  }
  if (url === "https://prestocks.com/api/prestocks") {
    return new Response(JSON.stringify([{ symbol: "SPACEX", markPrice: 90 }]), { status: 200 });
  }
  if (url === "https://api.mainnet-beta.solana.com") {
    const { id } = JSON.parse(init.body);
    const value = [{ executable: false, owner: "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ", lamports: 1, rentEpoch: 0, data: [priceUpdateV2(pythCore.price, pythCore.publishTime), "base64"] }];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: { context: { slot: 1 }, value } }), { status: 200 });
  }
  if (url.startsWith("https://api.backpack.exchange/api/v1/ticker?symbol=AAPL.US_USDC")) {
    return new Response(JSON.stringify({ symbol: "AAPL.US_USDC", lastPrice: aaplTicker }), { status: 200 });
  }
  throw new Error(`unexpected fetch ${url}`);
};

const { getReference, referenceChain } = await import("../src/lib/reference.ts");
const { wrappers, companyById } = await import("../src/lib/registry.ts");
const { fmtAge } = await import("../src/lib/units.ts");

const bySymbol = (sym) => wrappers.find((w) => w.symbol === sym);
const spcx = companyById.get("spcx");
const spcxx = bySymbol("SPCXx");
const spcxUs = bySymbol("SPCX.US");
const tSpaceX = bySymbol("tSpaceX");
const spaceX = bySymbol("SPACEX");
const aapl = companyById.get("aapl");
const aaplx = bySymbol("AAPLx");

test("cold instance, closed market: SPCXx and SPCX.US fall through to the last traded Backpack klines bar", async () => {
  now = Date.parse("2026-09-20T15:00:00Z"); // Sunday 11:00 EDT
  xstocksQuote = null;
  tickerBody = { symbol: "SPCX.US_USDC" }; // no lastPrice

  assert.deepEqual(referenceChain(spcxx, spcx), [
    "xstocks:SPCXx",
    "pyth-pro:3314",
    "backpack:SPCX.US_USDC",
    "backpack-klines:SPCX.US_USDC",
  ]);

  for (const w of [spcxx, spcxUs]) {
    const r = await getReference(w, spcx);
    assert.equal(r.price, 152.6432);
    assert.equal(r.asOf, 1789776000); // 2026-09-19T00:00:00Z, end of the last bar with trades
    assert.equal(r.ageSec, 140400);
    assert.equal(r.stale, false);
    assert.match(r.source, /hourly close/);
  }
});

test("closed market: the Backpack ticker price dates from the end of the last US session", async () => {
  now = Date.parse("2026-09-20T16:00:00Z");
  tickerBody = { symbol: "SPCX.US_USDC", lastPrice: "152.6432" };

  const r = await getReference(spcxUs, spcx);
  assert.match(r.source, /^Backpack consolidated US price/);
  assert.equal(r.asOf, 1789776000);
  assert.equal(r.ageSec, 144000);
});

test("issuer marks publish no time: tSpaceX and SPACEX have asOf and ageSec null and single-source chains", async () => {
  now = Date.parse("2026-09-20T17:00:00Z");

  assert.deepEqual(referenceChain(tSpaceX, spcx), ["tessera:tSpaceX"]);
  assert.deepEqual(referenceChain(spaceX, spcx), ["prestocks:SPACEX"]);

  const rt = await getReference(tSpaceX, spcx);
  assert.equal(rt.price, 423);
  assert.equal(rt.asOf, null);
  assert.equal(rt.ageSec, null);

  const rs = await getReference(spaceX, spcx);
  assert.equal(rs.price, 90);
  assert.equal(rs.asOf, null);
  assert.equal(rs.ageSec, null);
});

test("fmtAge(null) prints time not published", () => {
  assert.equal(fmtAge(null), "time not published");
});

test("open breaker skips its rung and the next healthy rung serves a fresh price", async () => {
  now = Date.parse("2026-09-22T15:00:00Z"); // Tuesday 11:00 EDT
  xstocksQuote = 150;
  xstocksStatus = 200;
  tickerBody = { symbol: "SPCX.US_USDC", lastPrice: "154" };

  const r1 = await getReference(spcxx, spcx);
  assert.equal(r1.price, 150);

  // Three real xStocks failures 31 s apart, beating its 30 s cooldown, open the breaker.
  xstocksStatus = 500;
  for (let i = 0; i < 3; i++) {
    now += 31000;
    const r = await getReference(spcxx, spcx);
    assert.equal(r.price, 154);
  }

  // Past xStocks' 30 s cooldown but inside the 60 s breaker window: only the breaker can keep xStocks from being called.
  const callsBefore = xstocksCalls;
  now += 31000;
  const r5 = await getReference(spcxx, spcx);
  assert.equal(xstocksCalls, callsBefore);
  assert.equal(r5.price, 154);
  assert.equal(r5.stale, false);
});

test("regular session: a Pyth Core print 20 minutes old is a miss and the Backpack ticker serves AAPLx", async () => {
  now = Date.parse("2026-09-22T16:00:00Z"); // Tuesday 12:00 EDT
  pythCore = { price: 256, publishTime: 1790091600 }; // 2026-09-22T15:40:00Z
  aaplTicker = "256.4";

  assert.deepEqual(referenceChain(aaplx, aapl), [
    "pyth-core:49f6b65c",
    "pyth-pro:922",
    "backpack:AAPL.US_USDC",
    "xstocks:AAPLx",
    "backpack-klines:AAPL.US_USDC",
  ]);

  const r = await getReference(aaplx, aapl);
  assert.match(r.source, /^Backpack consolidated US price \(AAPL\.US_USDC/);
  assert.equal(r.price, 256.4);
  assert.equal(r.asOf, 1790092800); // 2026-09-22T16:00:00Z
  assert.equal(r.ageSec, 0);
  assert.equal(r.stale, false);
});

test("regular session: a Pyth Core print 2 minutes old serves AAPLx", async () => {
  now = Date.parse("2026-09-22T17:00:00Z"); // Tuesday 13:00 EDT
  pythCore = { price: 257.5, publishTime: 1790096280 }; // 2026-09-22T16:58:00Z
  aaplTicker = "257.9";

  const r = await getReference(aaplx, aapl);
  assert.match(r.source, /^Pyth Core on-chain account, verification full/);
  assert.equal(r.price, 257.5);
  assert.equal(r.asOf, 1790096280);
  assert.equal(r.ageSec, 120);
  assert.equal(r.pythMark, true);
  assert.equal(r.stale, false);
});

test("closed market: a Pyth Core print from the Friday 16:00 ET close still serves AAPLx on Saturday", async () => {
  now = Date.parse("2026-09-26T15:00:00Z"); // Saturday 11:00 EDT
  pythCore = { price: 258.5, publishTime: 1790366400 }; // 2026-09-25T20:00:00Z, Friday 16:00 EDT
  aaplTicker = "258.8"; // decoy

  const r = await getReference(aaplx, aapl);
  assert.match(r.source, /^Pyth Core on-chain account/);
  assert.equal(r.price, 258.5);
  assert.equal(r.asOf, 1790366400);
  assert.equal(r.ageSec, 68400);
});

test("closed market: a Pyth Core print 7 days old is a miss and the Backpack ticker serves AAPLx", async () => {
  now = Date.parse("2026-09-27T15:00:00Z"); // Sunday 11:00 EDT
  pythCore = { price: 250, publishTime: 1789916400 }; // 2026-09-20T15:00:00Z, decoy
  aaplTicker = "255.5";

  const r = await getReference(aaplx, aapl);
  assert.match(r.source, /^Backpack consolidated US price \(AAPL\.US_USDC/);
  assert.equal(r.price, 255.5);
  assert.equal(r.asOf, 1790380800); // 2026-09-26T00:00:00Z, Friday 20:00 EDT, end of the last session
  assert.equal(r.ageSec, 140400);
  assert.equal(r.stale, false);
});
