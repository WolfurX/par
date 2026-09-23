// Verify src/lib/history.ts against live sources.
// Run from the repo root: node --env-file=.env.local scripts/verify-history.mjs

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

const { getHistory } = await import("../src/lib/history.ts");
const { getPools } = await import("../src/lib/pools.ts");
const { getMintStates } = await import("../src/lib/rpc.ts");
const { wrappers } = await import("../src/lib/registry.ts");

const bySymbol = (sym) => wrappers.find((w) => w.symbol === sym);

const targets = ["AAPLx", "tOpenAI", "OPENAI", "SPCX.US"];

const iso = (t) => new Date(t * 1000).toISOString().replace(".000Z", "Z");

for (const symbol of targets) {
  const w = bySymbol(symbol);
  if (!w) {
    console.log(`=== ${symbol} === registry has no wrapper with this symbol\n`);
    continue;
  }
  console.log(`=== ${w.symbol} (mint ${w.mint}) ===`);
  try {
    const h = await getHistory(w.mint, "7d");
    console.log(`  pool:       dex=${h.pool.dexId} pair=${h.pool.pairAddress}`);
    console.log(`  check:      https://dexscreener.com/solana/${h.pool.pairAddress}`);
    console.log(`  candles:    ${h.candles.length}`);
    console.log(`  source:     ${h.source}`);
    if (h.candles.length > 0) {
      const first = h.candles[0];
      const last = h.candles[h.candles.length - 1];
      console.log(`  first:      ${iso(first.t)}`);
      console.log(`  last:       ${iso(last.t)}`);
      console.log(`  lastClose:  ${last.c}`);
      const [pools, states] = await Promise.all([getPools([w.mint]), getMintStates([w.mint])]);
      const top = pools.get(w.mint)?.topPool;
      const m = states.get(w.mint)?.multiplier ?? 1;
      const poolUnitPrice = top ? top.priceUsdRaw / m : NaN;
      console.log(`  pool price: ${poolUnitPrice} (topPool.priceUsdRaw ${top?.priceUsdRaw} / m ${m})`);
      console.log(`  ratio:      ${last.c / poolUnitPrice}`);
    }
  } catch (e) {
    console.log(`  FAILED:     ${e.message}`);
  }
  console.log();
}

// 30d candle count and source, one wrapper.
{
  const w = bySymbol("tOpenAI");
  console.log(`=== tOpenAI, 30d ===`);
  try {
    const h = await getHistory(w.mint, "30d");
    console.log(`  candles:    ${h.candles.length}`);
    console.log(`  source:     ${h.source}`);
  } catch (e) {
    console.log(`  FAILED:     ${e.message}`);
  }
  console.log();
}

// Repeat 7d call to show the 5 minute cache.
{
  const w = bySymbol("tOpenAI");
  console.log(`=== tOpenAI, repeat 7d (cache check) ===`);
  const t0 = Date.now();
  try {
    await getHistory(w.mint, "7d");
    console.log(`  elapsed:    ${Date.now() - t0} ms`);
  } catch (e) {
    console.log(`  FAILED:     ${e.message}`);
  }
}
