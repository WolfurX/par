// DexScreener depth and volume, with a Jupiter liquidity fallback on DexScreener errors.
// Raw-unit rule: DexScreener prices are per raw token; topPool.priceUsdRaw is the only price here and it is raw.

import type { PoolInfo } from "./types";

const DEXSCREENER_BASE_DEFAULT = "https://api.dexscreener.com/token-pairs/v1/solana";
const JUPITER_SEARCH = "https://lite-api.jup.ag/tokens/v2/search";
const CACHE_TTL_SEC = 60;
const FAIL_CACHE_TTL_SEC = 10; // throttle retries on sustained upstream outage
const MAX_CONCURRENT = 4;
const JUPITER_FALLBACK_GAP_MS = 2000; // keyless Jupiter fallback: pace 1 per 2 s

// Read at call time (not module load) so scripts/verify-pools.mjs can force the
// Jupiter fallback path for one mint without restarting the process.
function dexScreenerBase(): string {
  return process.env.DEXSCREENER_BASE_OVERRIDE || DEXSCREENER_BASE_DEFAULT;
}

interface CacheEntry {
  data: PoolInfo;
  expiresAt: number; // unix seconds
}

const cache = new Map<string, CacheEntry>();
const lastGood = new Map<string, PoolInfo>();
const failCount = new Map<string, number>();

let jupiterFallbackChain: Promise<void> = Promise.resolve();

interface DexScreenerPair {
  dexId: string;
  pairAddress: string;
  baseToken: { address: string };
  quoteToken: { address: string; symbol: string };
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceUsd?: string;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function emptyPool(mint: string): PoolInfo {
  return { mint, liquidityUsd: 0, volume24hUsd: 0, fetchedAt: nowSec() };
}

async function fetchDexScreener(mint: string): Promise<PoolInfo> {
  const res = await fetch(`${dexScreenerBase()}/${mint}`, { next: { revalidate: CACHE_TTL_SEC } });
  if (!res.ok) throw new Error(`DexScreener ${res.status} for ${mint}`);
  const pairs = (await res.json()) as DexScreenerPair[] | null;
  if (!Array.isArray(pairs) || pairs.length === 0) return emptyPool(mint);

  const ours = pairs.filter((p) => p.baseToken?.address === mint);
  if (ours.length === 0) return emptyPool(mint);

  let liquidityUsd = 0;
  let volume24hUsd = 0;
  let top: DexScreenerPair | null = null;
  for (const p of ours) {
    const liq = p.liquidity?.usd ?? 0;
    liquidityUsd += liq;
    volume24hUsd += p.volume?.h24 ?? 0;
    if (!top || liq > (top.liquidity?.usd ?? 0)) top = p;
  }

  const info: PoolInfo = { mint, liquidityUsd, volume24hUsd, fetchedAt: nowSec() };
  if (top) {
    info.topPool = {
      dexId: top.dexId,
      pairAddress: top.pairAddress,
      quoteSymbol: top.quoteToken?.symbol ?? "",
      liquidityUsd: top.liquidity?.usd ?? 0,
      priceUsdRaw: Number(top.priceUsd ?? 0),
    };
  }
  return info;
}

/** Paced to at most one call per JUPITER_FALLBACK_GAP_MS across all callers. */
async function fetchJupiterFallback(mint: string): Promise<PoolInfo> {
  const run = jupiterFallbackChain.then(
    () => new Promise<void>((resolve) => setTimeout(resolve, JUPITER_FALLBACK_GAP_MS)),
  );
  jupiterFallbackChain = run;
  await run;

  const res = await fetch(`${JUPITER_SEARCH}?query=${mint}`);
  if (!res.ok) throw new Error(`Jupiter search ${res.status} for ${mint}`);
  const results = (await res.json()) as Array<{ id?: string; liquidity?: number }> | null;
  if (!Array.isArray(results)) return emptyPool(mint);
  // Jupiter's MintInformation only carries the mint under `id`; results[0] is a
  // documented last-resort for a query that returned no exact id match.
  const match = results.find((r) => r.id === mint) ?? results[0];
  if (!match || typeof match.liquidity !== "number") return emptyPool(mint);
  return { mint, liquidityUsd: match.liquidity, volume24hUsd: 0, fetchedAt: nowSec() };
}

async function resolveOne(mint: string): Promise<PoolInfo> {
  const cached = cache.get(mint);
  if (cached && cached.expiresAt > nowSec()) return cached.data;

  try {
    const info = await fetchDexScreener(mint);
    cache.set(mint, { data: info, expiresAt: nowSec() + CACHE_TTL_SEC });
    lastGood.set(mint, info);
    failCount.set(mint, 0);
    return info;
  } catch (dexErr) {
    try {
      const info = await fetchJupiterFallback(mint);
      cache.set(mint, { data: info, expiresAt: nowSec() + CACHE_TTL_SEC });
      lastGood.set(mint, info);
      failCount.set(mint, 0);
      return info;
    } catch (jupErr) {
      const fails = (failCount.get(mint) ?? 0) + 1;
      failCount.set(mint, fails);
      const good = lastGood.get(mint);
      if (fails >= 3 && good) {
        const ageSec = nowSec() - good.fetchedAt;
        console.error(`[pools] ${mint}: DexScreener and Jupiter both failed (${fails}x); serving last good, ${ageSec}s old`);
        cache.set(mint, { data: good, expiresAt: nowSec() + CACHE_TTL_SEC });
        return good;
      }
      console.error(
        `[pools] ${mint}: DexScreener error (${(dexErr as Error).message}); Jupiter fallback error (${(jupErr as Error).message})`,
      );
      const empty = emptyPool(mint);
      cache.set(mint, { data: empty, expiresAt: nowSec() + FAIL_CACHE_TTL_SEC });
      return empty;
    }
  }
}

export async function getPools(mints: string[]): Promise<Map<string, PoolInfo>> {
  const unique = Array.from(new Set(mints));
  const result = new Map<string, PoolInfo>();

  let cursor = 0;
  async function worker() {
    while (cursor < unique.length) {
      const mint = unique[cursor++];
      result.set(mint, await resolveOne(mint));
    }
  }
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT, unique.length) }, () => worker());
  await Promise.all(workers);

  return result;
}
