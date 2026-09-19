// Verify src/lib/pools.ts against live DexScreener data.
// Run: cd /home/rizki/projects/par && node --env-file=.env.local scripts/verify-pools.mjs

import { getPools } from "../src/lib/pools.ts";
import { wrappers } from "../src/lib/registry.ts";

const bySymbol = (sym) => wrappers.find((w) => w.symbol === sym);

const targets = [
  { label: "tOpenAI", symbol: "tOpenAI", expect: "about 570K liquidity" },
  { label: "PreStocks OPENAI", symbol: "OPENAI", expect: "about 120K liquidity" },
  { label: "AAPLx", symbol: "AAPLx", expect: "about 600K liquidity across 18 pools" },
  { label: "SPCX.US", symbol: "SPCX.US", expect: "no expectation given" },
  { label: "AAPLon", symbol: "AAPLon", expect: "near 0 liquidity" },
];

const mints = [];
for (const t of targets) {
  const w = bySymbol(t.symbol);
  if (!w) {
    console.error(`registry: no wrapper for symbol ${t.symbol}`);
    continue;
  }
  mints.push(w.mint);
}

console.log(`Fetching pools for ${mints.length} mints (cache 60s, 4 concurrent)...\n`);
const start = Date.now();
const pools = await getPools(mints);
console.log(`Done in ${Date.now() - start} ms\n`);

for (const t of targets) {
  const w = bySymbol(t.symbol);
  if (!w) continue;
  const p = pools.get(w.mint);
  console.log(`--- ${t.label} (${w.symbol}, mint ${w.mint}) ---`);
  console.log(`  expected:     ${t.expect}`);
  if (!p) {
    console.log("  result:       NO DATA");
    continue;
  }
  console.log(`  liquidityUsd: ${p.liquidityUsd.toLocaleString("en-US")}`);
  console.log(`  volume24hUsd: ${p.volume24hUsd.toLocaleString("en-US")}`);
  if (p.topPool) {
    console.log(
      `  topPool:      dex=${p.topPool.dexId} pair=${p.topPool.pairAddress} quote=${p.topPool.quoteSymbol} liquidityUsd=${p.topPool.liquidityUsd.toLocaleString("en-US")}`,
    );
    console.log(`  check:        https://dexscreener.com/solana/${p.topPool.pairAddress}`);
  } else {
    console.log("  topPool:      none");
  }
  console.log(`  fetchedAt:    ${new Date(p.fetchedAt * 1000).toISOString()}`);
  console.log();
}

// Second call within 60s should hit the in-memory cache (near-instant, no network).
const t2 = Date.now();
await getPools(mints);
console.log(`Second call (should be cache hits): ${Date.now() - t2} ms`);

// Force the Jupiter fallback path: point DexScreener at a bad host so it errors
// for every request, then prove parsing and the 2s pacing on two distinct mints.
console.log(`\n--- Forced Jupiter fallback (DexScreener host overridden to fail) ---`);
// A closed local port refuses the connection in milliseconds; an unresolvable
// hostname instead hangs on DNS for tens of seconds, which is not what we want here.
process.env.DEXSCREENER_BASE_OVERRIDE = "http://127.0.0.1:1";

// Distinct mints from the 5 targets above (still fresh in the cache) so this
// call cannot serve a cached DexScreener result and actually hits the fallback.
const fallbackMints = [bySymbol("TSLAx")?.mint, bySymbol("NVDAx")?.mint].filter(Boolean);
const f0 = Date.now();
const fallbackPools = await getPools(fallbackMints);
const fallbackMs = Date.now() - f0;
console.log(`Two forced-fallback calls took ${fallbackMs} ms (expect >= ~${2000} ms for the second call's pacing wait)`);

for (const mint of fallbackMints) {
  const p = fallbackPools.get(mint);
  console.log(`  ${mint}: liquidityUsd=${p?.liquidityUsd ?? "NO DATA"}`);
  console.log(`  cross-check: https://lite-api.jup.ag/tokens/v2/search?query=${mint}`);
}

delete process.env.DEXSCREENER_BASE_OVERRIDE;
