// Reproduces the Impact defect in computeRow (src/lib/ranking.ts): it returned Jupiter's own priceImpactPct,
// which is unreliable on these tokens, instead of comparing the price paid at size against the pool's small-size
// mid, and it did not remove the issuer's Token-2022 transfer fee (already inside the quoted price) before
// comparing. computeRow is pure, so there is no network. Expected values are worked by hand from the fixtures.
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

const { computeRow } = await import("../src/lib/ranking.ts");

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

test("impact takes the Tessera 0.2% transfer fee out before comparing with the mid", () => {
  // unit 1068, x(1 - 0.002) = 1065.864, over mid 1057, minus 1 = 8.864/1057 (about 0.84%).
  const row = computeRow(tesseraFixture());
  assert.ok(Math.abs(row.impact - 8.864 / 1057) < 1e-12);
});

test("impact takes the PreStocks 1% transfer fee out and compares per displayed unit", () => {
  // rawPrice 2846 / m 2 = unit 1423; x(1 - 0.01) = 1408.77, over mid 1406, minus 1 = 2.77/1406 (about 0.20%).
  // Without taking the fee out first it would be 1423/1406 - 1 = 17/1406 (about 1.21%).
  const row = computeRow({
    wrapper: { issuer: "prestocks", decimals: 9 },
    legal: { transferFeeBps: 100 },
    reference: null,
    state: { multiplier: 2, transferFeeBps: 100 },
    pool: { liquidityUsd: 100_000, volume24hUsd: 10_000 },
    sell: null,
    buy: { expectedRaw: "1000000000", minimumRaw: "1000000000", priceImpactPct: -0.019, routeLabels: [] },
    sizeUsdc: 2846,
    feeBps: 0,
    mid: 1406,
  });
  assert.ok(Math.abs(row.impact - 2.77 / 1406) < 1e-12);
});

test("impact compares the price net of Parsec's fee", () => {
  // 1,000 USDC with a 10 bps fee buys 1 token: 999 USDC reached the pool, so the unit price is 999; mid 990, no transfer fee.
  const row = computeRow(tesseraFixture({ legal: { transferFeeBps: 0 }, state: { multiplier: 1, transferFeeBps: 0 }, sizeUsdc: 1000, feeBps: 10, mid: 990 }));
  assert.ok(Math.abs(row.impact - 9 / 990) < 1e-12, String(row.impact));
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
  // unit 1000 x(1 - 0.002) = 998, under mid 1000: impact floors at 0, so the row is not thin
  // even though Jupiter's own priceImpactPct (0.35, the tSpaceX audit case) would say otherwise.
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

  // unit 1060 with no transfer fee, over mid 1000: impact 0.06, above THIN_IMPACT (0.05), so the row is thin
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
