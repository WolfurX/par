// Reference-price ladder. One reference per wrapper row, always carrying its source, its age, and
// whether it came from the last-good cache.
//
// Order, for a public name:
//   pyth-core (on-chain, keyless) -> pyth-pro -> backpack-external -> xstocks-price-data -> backpack-klines
// Pyth Pro is fresher than the on-chain account (200 ms vs about 11 s), so when PYTH_PRO_API_KEY is set
// and the equity feed is not known-unentitled, Pro leads for a pyth-core row. Without a key, or after a
// 403, the effective order is exactly the one above. The last rung, backpack-klines, is the last hourly
// bar on Backpack's External tape that had trades: it keeps a reference alive on a cold instance while
// the market is closed, when the ticker and the xStocks quote carry nothing.
//
// Ages. Pyth Core, Pyth Pro and the klines bar carry their own time. The ticker and the xStocks quote
// carry none, so they date from our fetch while a US session is running and from the end of the last
// session otherwise (src/lib/sessions.ts); Pyth Pro equity times get the same cap. Tessera and PreStocks
// publish no time for their marks, so asOf and ageSec are null on those rows.
//
// Pre-IPO names (Tessera, PreStocks) have no ladder: the issuer's own mark is the only reference that
// means anything, so the row fails to its last-good value rather than to somebody else's number.
//
// Caching: each upstream has a minimum interval between calls, held in an in-memory memo that doubles as
// the rate limiter (PreStocks is bulk-only, one call per 20 s). Route handlers additionally get Next's
// data cache through fetch({ next: { revalidate } }). Three failures in a row on one source open a
// breaker for 60 s; an open breaker skips its rung and the next is tried; only when every rung fails is
// the freshest last-good value served, marked stale.

import type { Company, Reference, ReferenceSource, Wrapper } from "./types";
import { wrappers } from "./registry";
import { readPythCoreOne } from "./pyth-core";
import { usPriceAsOf } from "./sessions";

const TESSERA_URL = "https://rest-api.tessera.pe/v1/public/token-details?symbol=x";
const PRESTOCKS_URL = "https://prestocks.com/api/prestocks";
const PYTH_PRO_URL = "https://pyth-lazer.dourolabs.app/v1/latest_price";

const TESSERA_TTL_SEC = 60;
const PRESTOCKS_TTL_SEC = 20;
const BACKPACK_TTL_SEC = 15;
const XSTOCKS_TTL_SEC = 30;
const PYTH_PRO_TTL_SEC = 5;

// A hung upstream must not hold a page open. The signal also opts the call out of Next per-render
// memoization, which the memo above already provides.
const FETCH_TIMEOUT_MS = 8000;

const BREAKER_FAILURES = 3;
const BREAKER_WINDOW_SEC = 60;
const UNENTITLED_SEC = 3600;

const KLINES_LOOKBACK_SEC = 4 * 86400; // reaches back over a weekend plus a Monday holiday

interface Fetched {
  price: number;
  asOf: number | null; // unix seconds the price dates from; null when the upstream publishes no time
  source: string;
  sourceUrl?: string;
  pythMark?: boolean;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Parse a JSON body, reporting the status rather than a parser message when the body is not JSON. */
async function asJson<T>(res: Response, label: string): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label}: HTTP ${res.status} with a non-JSON body (${text.slice(0, 60) || "empty"})`);
  }
}

// --- shared upstream memo, also the rate limiter -------------------------------------------------

const memo = new Map<string, { at: number; value: unknown }>();
const attemptAt = new Map<string, number>();
const inflight = new Map<string, Promise<unknown>>();

/** No upstream call was made: the previous one failed and its cooldown has not run out. Not a failure. */
class CooldownError extends Error {}

async function cached<T>(key: string, ttlSec: number, run: () => Promise<T>): Promise<T> {
  const t = Date.now() / 1000;
  const hit = memo.get(key);
  if (hit && t - hit.at < ttlSec) return hit.value as T;
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const last = attemptAt.get(key) ?? 0;
  if (t - last < ttlSec) throw new CooldownError(`upstream on cooldown for another ${Math.ceil(ttlSec - (t - last))} s`);
  attemptAt.set(key, t);
  const p = run()
    .then((value) => {
      memo.set(key, { at: Date.now() / 1000, value });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p as Promise<T>;
}

// --- last-good map and circuit breaker -----------------------------------------------------------

const lastGood = new Map<string, Fetched>();
const failures = new Map<string, number>();
const openUntil = new Map<string, number>();

async function attempt(key: string, run: () => Promise<Fetched>, errors: string[]): Promise<Fetched | null> {
  const now = nowSec();
  const open = openUntil.get(key) ?? 0;
  if (now < open) {
    errors.push(`${key}: breaker open for another ${open - now} s`);
    return null;
  }
  try {
    const value = await run();
    failures.delete(key);
    openUntil.delete(key);
    lastGood.set(key, value);
    return value;
  } catch (e) {
    errors.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
    // A cooldown rejection means we never called the upstream, so it cannot count as a failed call.
    if (e instanceof CooldownError) return null;
    const n = (failures.get(key) ?? 0) + 1;
    if (n >= BREAKER_FAILURES) {
      openUntil.set(key, now + BREAKER_WINDOW_SEC);
      failures.set(key, 0);
    } else {
      failures.set(key, n);
    }
    return null;
  }
}

// --- upstreams -----------------------------------------------------------------------------------

interface TesseraToken {
  code?: string;
  symbol?: string;
  mint?: string;
  markPrice?: number;
  markValuation?: number;
}

async function tesseraAll(): Promise<TesseraToken[]> {
  return cached(`tessera:all`, TESSERA_TTL_SEC, async () => {
    let status = 0;
    // The service returns 500 on roughly one call in seven. Four tries (about 0.1% joint failure), then the breaker.
    for (let i = 0; i < 4; i++) {
      const res = await fetch(TESSERA_URL, { next: { revalidate: TESSERA_TTL_SEC }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (res.ok) {
        const rows = await asJson<TesseraToken[]>(res, "tessera token-details");
        if (!Array.isArray(rows) || rows.length === 0) throw new Error("tessera token-details returned no rows");
        return rows;
      }
      status = res.status;
      if (status < 500) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`tessera token-details HTTP ${status}`);
  });
}

async function tesseraRef(code: string): Promise<Fetched> {
  const rows = await tesseraAll();
  const row = rows.find((r) => (r.code ?? "").toLowerCase() === code.toLowerCase());
  if (!row || typeof row.markPrice !== "number") throw new Error(`tessera: no markPrice for ${code}`);
  return {
    price: row.markPrice,
    asOf: null,
    source: `Tessera auction mark (${row.code})`,
    sourceUrl: TESSERA_URL,
  };
}

interface PreStocksToken {
  symbol?: string;
  contract_address?: string;
  markPrice?: number;
  tokenPrice?: number;
}

async function preStocksAll(): Promise<PreStocksToken[]> {
  return cached(`prestocks:bulk`, PRESTOCKS_TTL_SEC, async () => {
    // Bulk only. The per-symbol routes share a Vercel WAF bucket of roughly 22 to 34 calls a minute.
    const res = await fetch(PRESTOCKS_URL, { next: { revalidate: PRESTOCKS_TTL_SEC }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`prestocks bulk HTTP ${res.status}`);
    const rows = await asJson<PreStocksToken[]>(res, "prestocks bulk");
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("prestocks bulk returned no rows");
    return rows;
  });
}

async function preStocksRef(symbol: string): Promise<Fetched> {
  const rows = await preStocksAll();
  const row = rows.find((r) => (r.symbol ?? "").toUpperCase() === symbol.toUpperCase());
  if (!row || typeof row.markPrice !== "number") throw new Error(`prestocks: no markPrice for ${symbol}`);
  return {
    price: row.markPrice,
    asOf: null,
    source: `PreStocks mark (${symbol})`,
    sourceUrl: PRESTOCKS_URL,
  };
}

async function backpackRef(symbol: string): Promise<Fetched> {
  const url = `https://api.backpack.exchange/api/v1/ticker?symbol=${encodeURIComponent(symbol)}&source=External`;
  const got = await cached(`backpack:${symbol}`, BACKPACK_TTL_SEC, async () => {
    const res = await fetch(url, { next: { revalidate: BACKPACK_TTL_SEC }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`backpack ticker ${symbol} HTTP ${res.status}`);
    const body = await asJson<{ lastPrice?: string }>(res, `backpack ticker ${symbol}`);
    const price = Number(body.lastPrice);
    if (!Number.isFinite(price) || price <= 0) throw new Error(`backpack ticker ${symbol}: no lastPrice`);
    return { price, asOf: await usPriceAsOf(nowSec()) };
  });
  return {
    price: got.price,
    asOf: got.asOf,
    source: `Backpack consolidated US price (${symbol}, source=External)`,
    sourceUrl: url,
  };
}

async function xstocksRef(symbol: string): Promise<Fetched> {
  const url = `https://api.xstocks.fi/api/v2/public/assets/${encodeURIComponent(symbol)}/price-data`;
  const got = await cached(`xstocks:${symbol}`, XSTOCKS_TTL_SEC, async () => {
    const res = await fetch(url, { next: { revalidate: XSTOCKS_TTL_SEC }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`xstocks price-data ${symbol} HTTP ${res.status}`);
    const body = await asJson<{ quote?: number | null }>(res, `xstocks price-data ${symbol}`);
    // quote is null outside trading hours.
    if (typeof body.quote !== "number" || !Number.isFinite(body.quote) || body.quote <= 0) {
      throw new Error(`xstocks price-data ${symbol}: quote is ${JSON.stringify(body.quote)}`);
    }
    return { price: body.quote, asOf: await usPriceAsOf(nowSec()) };
  });
  return {
    price: got.price,
    asOf: got.asOf,
    source: `xStocks underlying quote (${symbol})`,
    sourceUrl: url,
  };
}

async function backpackKlinesRef(symbol: string): Promise<Fetched> {
  const url = `https://api.backpack.exchange/api/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=1h&startTime=${Math.floor(nowSec() / 3600) * 3600 - KLINES_LOOKBACK_SEC}&source=External`;
  return cached(`backpack-klines:${symbol}`, BACKPACK_TTL_SEC, async () => {
    const res = await fetch(url, { next: { revalidate: BACKPACK_TTL_SEC }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`backpack klines ${symbol} HTTP ${res.status}`);
    const bars = await asJson<{ close: string; end: string; trades: string }[]>(res, `backpack klines ${symbol}`);
    // bars keep coming while the market is closed, flat with no trades; the price dates from the last bar that traded
    if (!Array.isArray(bars)) throw new Error(`backpack klines ${symbol}: not an array`);
    const bar = bars.findLast((b) => Number(b.trades) > 0);
    const price = bar ? Number(bar.close) : NaN;
    if (!bar || !Number.isFinite(price) || price <= 0) throw new Error(`backpack klines ${symbol}: no traded bar in 4 days`);
    return {
      price,
      asOf: Math.min(nowSec(), Date.parse(`${bar.end.replace(" ", "T")}Z`) / 1000),
      source: `Backpack consolidated US hourly close (${symbol}, source=External)`,
      sourceUrl: url,
    };
  });
}

async function pythCoreRef(feedId: string, shard?: number): Promise<Fetched> {
  const p = await readPythCoreOne(feedId, { shard });
  if (!p) throw new Error(`pyth core: no account for feed ${feedId.slice(0, 8)} on shard ${shard ?? 1}`);
  return {
    price: p.price,
    asOf: p.publishTime,
    source: `Pyth Core on-chain account, verification ${p.verification}`,
    sourceUrl: `https://solscan.io/account/${p.account}`,
    pythMark: true,
  };
}

// Pyth Pro. Feeds outside the key's entitlement answer 403; remember that for an hour rather than
// burning a call per render on a feed we are not allowed to read.
const unentitledUntil = new Map<number, number>();

function proUsable(proId: number | undefined): proId is number {
  if (proId === undefined) return false;
  if (!process.env.PYTH_PRO_API_KEY) return false;
  return nowSec() >= (unentitledUntil.get(proId) ?? 0);
}

async function proLatest(proId: number): Promise<{ price: number; asOf: number } | null> {
  const key = process.env.PYTH_PRO_API_KEY;
  if (!key) return null;
  if (nowSec() < (unentitledUntil.get(proId) ?? 0)) return null;
  return cached(`pyth-pro:${proId}`, PYTH_PRO_TTL_SEC, async () => {
    const res = await fetch(PYTH_PRO_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        priceFeedIds: [proId],
        properties: ["price", "exponent"],
        formats: [],
        channel: "fixed_rate@200ms",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) {
      unentitledUntil.set(proId, nowSec() + UNENTITLED_SEC);
      return null;
    }
    if (!res.ok) throw new Error(`pyth pro feed ${proId} HTTP ${res.status}`);
    const body = await asJson<{
      parsed?: {
        timestampUs?: string | number;
        priceFeeds?: { priceFeedId?: number; price?: string | number; exponent?: number }[];
      };
    }>(res, `pyth pro feed ${proId}`);
    const feeds = body.parsed?.priceFeeds ?? [];
    const feed = feeds.find((f) => f.priceFeedId === proId) ?? feeds[0];
    if (!feed || feed.price === undefined || feed.exponent === undefined) {
      throw new Error(`pyth pro feed ${proId}: no price in response`);
    }
    const price = Number(feed.price) * 10 ** feed.exponent;
    if (!Number.isFinite(price) || price <= 0) throw new Error(`pyth pro feed ${proId}: price ${feed.price}`);
    const us = Number(body.parsed?.timestampUs ?? 0);
    if (!(us > 0)) throw new Error(`pyth pro feed ${proId}: no timestamp`);
    return { price, asOf: Math.floor(us / 1e6) };
  });
}

async function pythProRef(proId: number, label: string): Promise<Fetched> {
  const got = await proLatest(proId);
  if (!got) throw new Error(`pyth pro feed ${proId}: no key or not entitled`);
  return { price: got.price, asOf: await usPriceAsOf(got.asOf), source: `${label} (Pyth Pro feed ${proId})`, pythMark: true };
}

/** Wrapper-side feeds (Crypto.<SYM>X/USD) and redemption rates (Crypto.<SYM>X/<SYM>.RR). Null without an entitled key. */
export async function getPythProPrice(proId: number): Promise<{ price: number; asOf: number } | null> {
  try {
    return await proLatest(proId);
  } catch {
    return null;
  }
}

/** 24/7 index feed (Pyth.Index.OPENAI/USD and friends), shown beside a pre-IPO mark. Null without an entitled key. */
export async function getPythIndex(proId: number): Promise<Reference | null> {
  const got = await getPythProPrice(proId);
  if (!got) return null;
  return {
    price: got.price,
    currency: "USD",
    source: `Pyth Index, 24/7 (feed ${proId})`,
    asOf: got.asOf,
    ageSec: Math.max(0, nowSec() - got.asOf),
    stale: false,
    pythMark: true,
  };
}

// --- the ladder ----------------------------------------------------------------------------------

interface Candidate {
  key: string;
  run: () => Promise<Fetched>;
}

function fromSource(src: ReferenceSource): Candidate {
  switch (src.kind) {
    case "pyth-core":
      return { key: `pyth-core:${src.feedId.slice(0, 8)}`, run: () => pythCoreRef(src.feedId, src.shard) };
    case "backpack-external":
      return { key: `backpack:${src.symbol}`, run: () => backpackRef(src.symbol) };
    case "tessera":
      return { key: `tessera:${src.code}`, run: () => tesseraRef(src.code) };
    case "prestocks":
      return { key: `prestocks:${src.symbol}`, run: () => preStocksRef(src.symbol) };
    case "xstocks-price-data":
      return { key: `xstocks:${src.symbol}`, run: () => xstocksRef(src.symbol) };
  }
}

function backpackSymbolFor(company: Company): string | null {
  const w = wrappers.find((x) => x.companyId === company.id && x.issuer === "backpack");
  if (!w) return null;
  if (w.reference.kind === "backpack-external") return w.reference.symbol;
  return company.ticker ? `${company.ticker}.US_USDC` : null;
}

function xstocksSymbolFor(company: Company): string | null {
  const w = wrappers.find((x) => x.companyId === company.id && x.issuer === "xstocks");
  if (w) return w.reference.kind === "xstocks-price-data" ? w.reference.symbol : w.symbol;
  return company.ticker ? `${company.ticker}x` : null;
}

function buildChain(wrapper: Wrapper, company: Company): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const push = (c: Candidate | null) => {
    if (c && !seen.has(c.key)) {
      seen.add(c.key);
      out.push(c);
    }
  };

  const equityPro = company.pythEquityProId;
  const proCandidate: Candidate | null = equityPro
    ? { key: `pyth-pro:${equityPro}`, run: () => pythProRef(equityPro, `${company.ticker ?? company.name} underlying`) }
    : null;

  // Pro is the fresher read of the same equity feed, so it leads when a key is set and entitled.
  if (wrapper.reference.kind === "pyth-core" && proUsable(equityPro)) push(proCandidate);

  push(fromSource(wrapper.reference));

  // Issuer marks for pre-IPO names have no substitute. Do not fall through to another company's price.
  // The test is the wrapper's own source, not the company's kind: SpaceX listed in June 2026, so its
  // Company record is public, but tSpaceX and SPACEX are still SPV/loan-participation marks and must
  // never be backfilled with the listed SPCX share price.
  const preIpoSource = wrapper.reference.kind === "tessera" || wrapper.reference.kind === "prestocks";
  if (preIpoSource || company.kind !== "public") return out;

  if (company.pythEquityFeedId) {
    const feedId = company.pythEquityFeedId;
    push({ key: `pyth-core:${feedId.slice(0, 8)}`, run: () => pythCoreRef(feedId) });
  }
  push(proCandidate);
  const bp = backpackSymbolFor(company);
  if (bp) push({ key: `backpack:${bp}`, run: () => backpackRef(bp) });
  const xs = xstocksSymbolFor(company);
  if (xs) push({ key: `xstocks:${xs}`, run: () => xstocksRef(xs) });
  if (bp) push({ key: `backpack-klines:${bp}`, run: () => backpackKlinesRef(bp) });

  return out;
}

/** The source keys this wrapper would try, in order. Exported so the label and the verify script can show the path. */
export function referenceChain(wrapper: Wrapper, company: Company): string[] {
  return buildChain(wrapper, company).map((c) => c.key);
}

function finish(f: Fetched, stale: boolean): Reference {
  return {
    price: f.price,
    currency: "USD",
    source: f.source,
    sourceUrl: f.sourceUrl,
    asOf: f.asOf,
    ageSec: f.asOf === null ? null : Math.max(0, nowSec() - f.asOf),
    stale,
    pythMark: f.pythMark,
  };
}

export async function getReference(wrapper: Wrapper, company: Company): Promise<Reference> {
  const chain = buildChain(wrapper, company);
  if (chain.length === 0) throw new Error(`reference: no source configured for ${wrapper.symbol}`);
  const errors: string[] = [];

  for (const c of chain) {
    const got = await attempt(c.key, c.run, errors);
    if (got) return finish(got, false);
  }

  // Everything in the chain failed this pass: serve the freshest last-good value we hold for it.
  let best: Fetched | undefined;
  for (const c of chain) {
    const good = lastGood.get(c.key);
    if (good && (!best || (good.asOf ?? 0) > (best.asOf ?? 0))) best = good;
  }
  if (best) {
    console.warn(`[reference] ${wrapper.symbol}: all sources failed, serving last good${best.asOf === null ? "" : ` ${nowSec() - best.asOf} s old`}`);
    return finish(best, true);
  }
  throw new Error(`reference unavailable for ${wrapper.symbol}: ${errors.join("; ")}`);
}
