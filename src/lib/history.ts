// Price candles for the label chart: GeckoTerminal OHLCV on the wrapper's top DexScreener pool, with
// Jupiter datapi as the fallback.
//
// Raw-unit rule: GeckoTerminal closes are per raw token, so they are divided by the effective multiplier
// (rawPriceToUnitPrice from units.ts) before they leave this module; Jupiter datapi closes are already per
// displayed unit and pass through unscaled. Verified live 2026-09-20 against OPENAI (PreStocks, mint
// PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF, multiplier m 1.4861347): GeckoTerminal's latest hourly
// close was 1713.63 USD per raw token, matching pools.ts's DexScreener priceUsdRaw of 1709.30 for the same
// pool (both per raw token, within 0.3%); the same hour's Jupiter datapi close was 1149.82 USD, matching
// 1713.63 / m = 1153.13 (both per displayed unit, within 0.3%).
//
// Budget: results are cached 5 minutes per mint and range. GeckoTerminal calls are serialised one at a
// time, at least GECKO_GAP_MS apart (its public tier throttles near 30 calls a minute and CDN-caches 30 to
// 60 s), and this module never calls GeckoTerminal's tokens/<mint>/pools endpoint, which throttles first.
// Two concurrent misses on the same key make two GeckoTerminal calls; the 5 minute cache makes that rare,
// so there is no in-flight map here.

import { getPools } from "./pools";
import { getMintStates } from "./rpc";
import { rawPriceToUnitPrice } from "./units";

export interface Candle {
  t: number; // unix seconds
  o: number;
  h: number;
  l: number;
  c: number; // USD per displayed unit
  v: number;
}

export type HistoryRange = "7d" | "30d";

export interface History {
  candles: Candle[];
  pool: { pairAddress: string; dexId: string } | null;
  source: "geckoterminal" | "jupiter" | null;
  fetchedAt: number; // unix seconds
}

const GECKO_BASE = "https://api.geckoterminal.com/api/v2/networks/solana/pools";
const JUP_CHARTS = "https://datapi.jup.ag/v2/charts";
const CACHE_TTL_MS = 300_000;
const GECKO_GAP_MS = 2200;
const FAIL_LIMIT = 3;
const LAST_GOOD_MS = 60_000;
const FETCH_TIMEOUT_MS = 8000;

const RANGES: Record<HistoryRange, { gt: string; limit: number; jup: string }> = {
  "7d": { gt: "hour", limit: 168, jup: "1_HOUR" },
  "30d": { gt: "day", limit: 30, jup: "1_DAY" },
};

interface CacheEntry {
  data: History;
  expiresAt: number; // ms
}

const cache = new Map<string, CacheEntry>();
const lastGood = new Map<string, History>();
const failCount = new Map<string, number>();
const staleUntil = new Map<string, number>(); // ms

let gtChain: Promise<unknown> = Promise.resolve();

/** Paced to at most one call per GECKO_GAP_MS across all callers. */
async function fetchGecko(pairAddress: string, cfg: { gt: string; limit: number }): Promise<Candle[]> {
  const run = gtChain.then(() => new Promise((r) => setTimeout(r, GECKO_GAP_MS)));
  gtChain = run;
  await run;

  const res = await fetch(`${GECKO_BASE}/${pairAddress}/ohlcv/${cfg.gt}?limit=${cfg.limit}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`geckoterminal ohlcv ${cfg.gt} HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
  const list = body.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list) || list.length === 0) throw new Error(`geckoterminal ohlcv ${cfg.gt}: empty list`);
  // Payload is newest first; sort ascending.
  const candles: Candle[] = list.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));
  candles.sort((a, b) => a.t - b.t);
  return candles;
}

async function fetchJupiter(mint: string, cfg: { limit: number; jup: string }): Promise<Candle[]> {
  const res = await fetch(`${JUP_CHARTS}/${mint}?interval=${cfg.jup}&to=${Date.now()}&candles=${cfg.limit}&type=price`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`jupiter datapi charts HTTP ${res.status}`);
  const body = (await res.json()) as { candles?: { time: number; open: number; high: number; low: number; close: number; volume: number }[] };
  const list = body.candles;
  if (!Array.isArray(list) || list.length === 0) throw new Error("jupiter datapi charts: empty candles");
  // datapi returns candles ascending by time already.
  return list.map((c) => ({ t: c.time, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume }));
}

function finish(key: string, candles: Candle[], pool: { pairAddress: string; dexId: string }, source: History["source"]): History {
  const data: History = { candles, pool, source, fetchedAt: Math.floor(Date.now() / 1000) };
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  lastGood.set(key, data);
  failCount.set(key, 0);
  staleUntil.delete(key);
  return data;
}

export async function getHistory(mint: string, range: HistoryRange = "7d"): Promise<History> {
  const key = `${mint}:${range}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;

  const cfg = RANGES[range];
  const [pools, states] = await Promise.all([getPools([mint]), getMintStates([mint])]);
  const info = pools.get(mint);
  if (info?.noPair) return { candles: [], pool: null, source: null, fetchedAt: Math.floor(Date.now() / 1000) }; // no pool (Backpack AAPL.US, SPY.US): no history, not an upstream failure
  const top = info?.topPool;
  if (!top) throw new Error(`history: no DexScreener pool for ${mint}`);
  const m = states.get(mint)?.multiplier ?? 1;
  const pool = { pairAddress: top.pairAddress, dexId: top.dexId };

  let geckoMsg = "";
  let jupMsg = "";

  try {
    const raw = await fetchGecko(top.pairAddress, cfg);
    const candles: Candle[] = raw.map((c) => ({
      t: c.t,
      o: rawPriceToUnitPrice(c.o, m),
      h: rawPriceToUnitPrice(c.h, m),
      l: rawPriceToUnitPrice(c.l, m),
      c: rawPriceToUnitPrice(c.c, m),
      v: c.v,
    }));
    return finish(key, candles, pool, "geckoterminal");
  } catch (e) {
    geckoMsg = e instanceof Error ? e.message : String(e);
  }

  try {
    const candles = await fetchJupiter(mint, cfg);
    return finish(key, candles, pool, "jupiter");
  } catch (e) {
    jupMsg = e instanceof Error ? e.message : String(e);
  }

  const fails = (failCount.get(key) ?? 0) + 1;
  failCount.set(key, fails);
  if (fails === FAIL_LIMIT) staleUntil.set(key, Date.now() + LAST_GOOD_MS);
  const good = lastGood.get(key);
  const until = staleUntil.get(key) ?? 0;
  if (fails >= FAIL_LIMIT && good && Date.now() < until) {
    console.warn(`[history] ${key}: both sources failed (${fails}x); serving last good, ${Math.floor(Date.now() / 1000) - good.fetchedAt}s old`);
    cache.set(key, { data: good, expiresAt: until });
    return good;
  }
  throw new Error(`history unavailable for ${mint} ${range}: ${geckoMsg}; ${jupMsg}`);
}
