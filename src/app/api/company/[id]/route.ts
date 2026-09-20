import { NextResponse } from "next/server";
import { companyById, wrappersForCompany } from "@/lib/registry";
import { legalFor, companyNotes } from "@/lib/legal";
import { getMintStates } from "@/lib/rpc";
import { getReference, getPythIndex } from "@/lib/reference";
import { getPools } from "@/lib/pools";
import { getMids } from "@/lib/jupprice";
import { quoteAtSize } from "@/lib/jupiter";
import { getMarketState, describeMarketState } from "@/lib/sessions";
import { rankRows, computeRow, INTENTS, type Intent } from "@/lib/ranking";
import type { Reference } from "@/lib/types";

export const dynamic = "force-dynamic";

const FEE_BPS = Number(process.env.FEE_BPS ?? 10);
const DEFAULT_SIZE = 1000;

// Company page composition. Rows are sized /order quotes, one per wrapper, quote only and cached 30 s;
// the buy screen simulates the selected wrapper.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const company = companyById.get(id);
  if (!company) return NextResponse.json({ error: "unknown company" }, { status: 404 });
  const url = new URL(req.url);
  const size = Math.min(1_000_000, Math.max(1, Number(url.searchParams.get("size") ?? DEFAULT_SIZE) || DEFAULT_SIZE));
  const sortParam = url.searchParams.get("sort");
  const sort: Intent = INTENTS.some((i) => i.id === sortParam) ? (sortParam as Intent) : "price";

  const ws = wrappersForCompany(id);
  const mints = ws.map((w) => w.mint);
  const [states, pools, mids, market] = await Promise.all([
    getMintStates(mints).catch(() => new Map()),
    getPools(mints).catch(() => new Map()),
    getMids(mints).catch(() => new Map()),
    company.kind === "public" ? getMarketState().catch(() => null) : Promise.resolve(null),
  ]);
  const sized = await Promise.all(
    ws.map(async (w) => {
      const pool = pools.get(w.mint) ?? null;
      if (pool && pool.liquidityUsd < 1) return { buy: null, sell: null, quoteError: null };
      try {
        const buy = await quoteAtSize(w.mint, "buy", String(Math.round(size * 1e6)));
        const sell = buy && buy.expectedRaw !== "0" ? await quoteAtSize(w.mint, "sell", buy.expectedRaw) : null;
        return { buy, sell, quoteError: buy ? null : "no route at this size" };
      } catch (e) {
        return { buy: null, sell: null, quoteError: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  const sizedByMint = new Map(ws.map((w, i) => [w.mint, sized[i]]));
  const refs = await Promise.all(ws.map((w) => getReference(w, company).catch(() => null)));
  const index = company.pythIndexProId ? await getPythIndex(company.pythIndexProId).catch(() => null) : null;

  const rows = ws.map((w, i) => {
    const state = states.get(w.mint) ?? null;
    const computed = computeRow({
      wrapper: w,
      legal: legalFor(w.issuer, w.legalId),
      reference: refs[i] as Reference | null,
      state,
      pool: pools.get(w.mint) ?? null,
      buy: sized[i].buy,
      sell: sized[i].sell,
      sizeUsdc: size,
      feeBps: FEE_BPS,
    });
    return computed;
  });

  const ranked = rankRows(rows, sort).map(({ row, rank }) => ({
    rank,
    mint: row.wrapper.mint,
    symbol: row.wrapper.symbol,
    issuer: row.wrapper.issuer,
    name: row.wrapper.name,
    unitPrice: row.unitPrice,
    multiplier: row.multiplier,
    reference: row.reference,
    premium: row.premium,
    premiumUsd: row.premiumUsd,
    liquidityUsd: row.liquidityUsd,
    volume24hUsd: row.volume24hUsd,
    noLiquidity: row.noLiquidity,
    thin: row.thin,
    belowMark: row.belowMark,
    own: row.legal.line + (companyNotes[company.id] ? " " + companyNotes[company.id] : ""),
    holdScore: row.legal.holdScore,
    redeemTier: row.legal.redeemTier,
    transferFeeBps: row.legal.transferFeeBps,
    powers: row.legal.powers,
    mid: mids.get(row.wrapper.mint)?.usdPricePerUnit ?? null,
    impact: row.impact,
    roundTripUsdc: row.roundTripUsdc,
    roundTripPct: row.roundTripPct,
    feesInBps: row.feesInBps,
    feesOutBps: row.feesOutBps,
    routeLabels: row.routeLabels,
    form: row.legal.form,
    redemption: row.legal.redemption,
    quoteError: sizedByMint.get(row.wrapper.mint)?.quoteError ?? null,
    quotedAt: sizedByMint.get(row.wrapper.mint)?.buy?.quotedAt ?? null,
  }));

  return NextResponse.json({
    company,
    sort,
    size,
    feeBps: FEE_BPS,
    market: market ? { ...market, text: describeMarketState(market) } : null,
    index: index ? { price: index.price, asOf: index.asOf, label: "Pyth index, 24/7" } : null,
    rows: ranked,
    generatedAt: Math.floor(Date.now() / 1000),
  });
}
