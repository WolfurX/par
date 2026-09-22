import { NextResponse } from "next/server";
import { companyById, wrapperByMint, USDC_MINT } from "@/lib/registry";
import { legalFor, companyNotes } from "@/lib/legal";
import { getMintStates } from "@/lib/rpc";
import { getReference, getPythProPrice, getPythIndex } from "@/lib/reference";
import { getPools } from "@/lib/pools";
import { getMids } from "@/lib/jupprice";
import { getQuote } from "@/lib/jupiter";
import { getMarketState, describeMarketState } from "@/lib/sessions";
import { computeRow } from "@/lib/ranking";
import type { QuoteResult } from "@/lib/types";

export const dynamic = "force-dynamic";

const FEE_BPS = Number(process.env.FEE_BPS ?? 10);

// The sized label: reference, mint state, pool, a buy quote at size, and a sell quote of exactly the expected amount.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mint = url.searchParams.get("mint") ?? "";
  const size = Math.max(1, Number(url.searchParams.get("size") ?? 1000) || 1000);
  const taker = url.searchParams.get("taker") ?? undefined;
  const w = wrapperByMint.get(mint);
  if (!w) return NextResponse.json({ error: "unknown wrapper" }, { status: 404 });
  const company = companyById.get(w.companyId)!;
  const legal = legalFor(w.issuer, w.legalId);

  const [states, pools, reference, market, mids] = await Promise.all([
    getMintStates([mint]).catch(() => new Map()),
    getPools([mint]).catch(() => new Map()),
    getReference(w, company).catch((e) => {
      console.warn(`[label] ${w.symbol}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }),
    company.kind === "public" ? getMarketState().catch(() => null) : Promise.resolve(null),
    getMids([mint]).catch(() => new Map()),
  ]);
  const state = states.get(mint) ?? null;
  const pool = pools.get(mint) ?? null;
  const liquidityHint = pool?.liquidityUsd ?? 0;

  let buy: QuoteResult | null = null;
  let sell: QuoteResult | null = null;
  let quoteError: string | null = null;
  if (!pool || pool.liquidityUsd > 0) {
    try {
      buy = await getQuote({ mint, side: "buy", amountRaw: String(Math.round(size * 1e6)), taker, slippageBps: liquidityHint > 500_000 ? 50 : 100 });
      if (buy && buy.expectedRaw !== "0") {
        sell = await getQuote({ mint, side: "sell", amountRaw: buy.expectedRaw, slippageBps: liquidityHint > 500_000 ? 50 : 100 });
      }
    } catch (e) {
      quoteError = e instanceof Error ? e.message : String(e);
    }
  }

  const [wrapperFeed, rr, index] = await Promise.all([
    w.pythWrapperProId ? getPythProPrice(w.pythWrapperProId).catch(() => null) : Promise.resolve(null),
    w.pythRedemptionRateProId ? getPythProPrice(w.pythRedemptionRateProId).catch(() => null) : Promise.resolve(null),
    company.pythIndexProId ? getPythIndex(company.pythIndexProId).catch(() => null) : Promise.resolve(null),
  ]);

  const row = computeRow({ wrapper: w, legal, reference, state, pool, buy, sell, sizeUsdc: size, feeBps: FEE_BPS, mid: mids.get(mint)?.usdPricePerUnit ?? null });

  return NextResponse.json({
    wrapper: w,
    company,
    legal: { ...legal, line: legal.line + (companyNotes[company.id] ? " " + companyNotes[company.id] : "") },
    state,
    pool,
    reference,
    market: market ? { ...market, text: describeMarketState(market) } : null,
    pyth: { wrapperFeed, redemptionRate: rr, index },
    size,
    feeBps: FEE_BPS,
    buy,
    sell,
    quoteError,
    row: {
      unitPrice: row.unitPrice,
      rawPrice: row.rawPrice,
      multiplier: row.multiplier,
      premium: row.premium,
      premiumUsd: row.premiumUsd,
      impact: row.impact,
      expectedUnits: row.expectedUnits,
      minimumUnits: row.minimumUnits,
      feesInBps: row.feesInBps,
      feesOutBps: row.feesOutBps,
      roundTripUsdc: row.roundTripUsdc,
      roundTripPct: row.roundTripPct,
      thin: row.thin,
      noLiquidity: row.noLiquidity,
      belowMark: row.belowMark,
      routeLabels: row.routeLabels,
      deliveryRatio: row.deliveryRatio,
      compare: row.compare,
    },
    usdcMint: USDC_MINT,
    generatedAt: Math.floor(Date.now() / 1000),
  });
}
