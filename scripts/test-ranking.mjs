// Impact in computeRow (src/lib/ranking.ts). It used to return Jupiter's own priceImpactPct, which is unreliable on
// these tokens, and then compared against the Jupiter Price v3 mid, which lags on thin mints. It now compares the unit
// price paid at size with the unit price of a small buy on the same path, both through unitPriceAt, so Parsec's fee
// and the issuer's transfer fee cancel. computeRow is pure, so there is no network. Expected values are worked by
// hand from the fixtures.
// Run: node --test scripts/test-ranking.mjs

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

const { computeRow, unitPriceAt } = await import("../src/lib/ranking.ts");

// tOpenAI-shaped fixture: Tessera, 0.2% transfer fee, size 1068 USDC, mid 1057. Reused in test (d).
function tesseraFixture(overrides = {}) {
  return {
    wrapper: { issuer: "tessera", decimals: 9 },
    legal: { transferFeeBps: 20 },
    reference: null,
    state: { multiplier: 1, transferFeeBps: 20 },
    pool: { liquidityUsd: 100_000, volume24hUsd: 10_000 },
    sell: null,
    buy: { expectedRaw: "1000000000", minimumRaw: "1000000000", priceImpactPct: -0.057, routeLabels: [] },
    sizeUsdc: 1068,
    feeBps: 0,
    mid: 1057,
    ...overrides,
  };
}

test("impact is the unit price at size over the unit price at the small size", () => {
  // 1,068 USDC buys 1 token with no fee: unit 1068; the small-size unit price (mid) is 1057; 1068/1057 - 1 = 11/1057.
  const row = computeRow(tesseraFixture());
  assert.ok(Math.abs(row.impact - 11 / 1057) < 1e-12, String(row.impact));
});

test("Parsec's fee cancels because the sized price and the mid both go through unitPriceAt", () => {
  // Multiplier 2. At size: 1,000 USDC buys 0.9 raw tokens. Small: 10 USDC buys 0.01 raw tokens.
  // Fee 0: unit 1000/0.9/2 = 555.56, mid 10/0.01/2 = 500, impact 1/9. Fee 10 bps: 999/0.9/2 = 555, 9.99/0.01/2 = 499.5, still 1/9.
  for (const feeBps of [0, 10]) {
    const small = { expectedRaw: "10000000", minimumRaw: "10000000", priceImpactPct: 0, routeLabels: [] };
    const mid = unitPriceAt(small, 10, feeBps, 9, 2);
    const row = computeRow(tesseraFixture({
      state: { multiplier: 2, transferFeeBps: 100 },
      buy: { expectedRaw: "900000000", minimumRaw: "900000000", priceImpactPct: 0, routeLabels: [] },
      sizeUsdc: 1000,
      feeBps,
      mid,
    }));
    assert.ok(Math.abs(row.impact - 1 / 9) < 1e-12, `fee ${feeBps}: ${row.impact}`);
  }
});

test("unitPriceAt is net of Parsec's fee and per displayed unit", () => {
  // 1,000 USDC with a 10 bps fee: 999 reached the pool for 1 raw token; multiplier 2 gives 499.5 per displayed unit.
  const q = { expectedRaw: "1000000000", minimumRaw: "1000000000", priceImpactPct: 0, routeLabels: [] };
  assert.equal(unitPriceAt(q, 1000, 10, 9, 2), 499.5);
  assert.equal(unitPriceAt(null, 1000, 10, 9, 2), null);
  assert.equal(unitPriceAt({ ...q, expectedRaw: "0" }, 1000, 10, 9, 2), null);
});

test("impact floors at 0 when the price paid is under the mid", () => {
  const row = computeRow({
    wrapper: { issuer: "xstocks", decimals: 8 },
    legal: { transferFeeBps: 0 },
    reference: null,
    state: { multiplier: 1, transferFeeBps: 0 },
    pool: { liquidityUsd: 100_000, volume24hUsd: 10_000 },
    sell: null,
    buy: { expectedRaw: "100000000", minimumRaw: "100000000", priceImpactPct: -0.0011, routeLabels: [] },
    sizeUsdc: 250,
    feeBps: 0,
    mid: 251,
  });
  assert.equal(row.impact, 0);
});

test("impact is null without a mid or without a buy quote", () => {
  assert.equal(computeRow(tesseraFixture({ mid: null })).impact, null);
  assert.equal(computeRow(tesseraFixture({ buy: null })).impact, null);
});

test("thin follows Parsec's impact, not Jupiter's priceImpactPct", () => {
  // unit 1000 over mid 1000: impact 0, so the row is not thin even though Jupiter's own
  // priceImpactPct (0.35, the tSpaceX audit case) would say otherwise.
  const notThin = computeRow({
    wrapper: { issuer: "tessera", decimals: 9 },
    legal: { transferFeeBps: 20 },
    reference: null,
    state: { multiplier: 1, transferFeeBps: 20 },
    pool: { liquidityUsd: 100_000, volume24hUsd: 10_000 },
    sell: null,
    buy: { expectedRaw: "1000000000", minimumRaw: "1000000000", priceImpactPct: 0.35, routeLabels: [] },
    sizeUsdc: 1000,
    feeBps: 0,
    mid: 1000,
  });
  assert.equal(notThin.impact, 0);
  assert.equal(notThin.thin, false);

  // unit 1060 over mid 1000: impact 0.06, above THIN_IMPACT (0.05), so the row is thin
  // even though Jupiter's own priceImpactPct (0) would say otherwise.
  const thin = computeRow({
    wrapper: { issuer: "tessera", decimals: 9 },
    legal: { transferFeeBps: 0 },
    reference: null,
    state: { multiplier: 1, transferFeeBps: 0 },
    pool: { liquidityUsd: 100_000, volume24hUsd: 10_000 },
    sell: null,
    buy: { expectedRaw: "1000000000", minimumRaw: "1000000000", priceImpactPct: 0, routeLabels: [] },
    sizeUsdc: 1060,
    feeBps: 0,
    mid: 1000,
  });
  assert.ok(Math.abs(thin.impact - 0.06) < 1e-12);
  assert.equal(thin.thin, true);
});
