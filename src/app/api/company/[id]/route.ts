import { NextResponse } from "next/server";
import { companyById, wrappersForCompany } from "@/lib/registry";
import { legalFor, companyNotes } from "@/lib/legal";
import { getMintStates } from "@/lib/rpc";
import { getReference, getPythIndex } from "@/lib/reference";
import { getPools } from "@/lib/pools";
import { quoteAtSize } from "@/lib/jupiter";
import { getMarketState, describeMarketState } from "@/lib/sessions";
import { rankRows, computeRow, unitPriceAt, INTENTS, MID_SIZE_USDC, type Intent } from "@/lib/ranking";
import type { Reference } from "@/lib/types";

export const dynamic = "force-dynamic";

const FEE_BPS = Number(process.env.FEE_BPS ?? 10);
const DEFAULT_SIZE = 1000;

// Company page composition, streamed as three NDJSON lines. The first is the frame without sized quotes.
// The second is the same rows with sized /order quotes, one per wrapper, quote only and cached 120 s.
// The third adds impact from a small quote per wrapper; under Sort by Liquidity, whose order depends on impact, the
// quoted line waits for it and is the last line.
// The buy screen simulates the selected wrapper.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const company = companyById.get(id);
  if (!company) return NextResponse.json({ error: "unknown company" }, { status: 404 });
  const url = new URL(req.url);
  // Whole USDC: sized quotes are cached per exact amount, so fractions would each cost a fresh Jupiter quote.
  const size = Math.round(Math.min(1_000_000, Math.max(1, Number(url.searchParams.get("size") ?? DEFAULT_SIZE) || DEFAULT_SIZE)));
  const sortParam = url.searchParams.get("sort");
  const sort: Intent = INTENTS.some((i) => i.id === sortParam) ? (sortParam as Intent) : "price";

  const ws = wrappersForCompany(id);
  const mints = ws.map((w) => w.mint);
  const poolsP = getPools(mints).catch(() => new Map());
  const sizedP = poolsP.then((pools) =>
    Promise.all(
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
    ),
  );
  // The mid for impact: a small buy on the same path, cached like the sized quotes. It is queued after the sized
  // quotes so it never delays them on the Jupiter pacing window, and it arrives as a third line.
  const smallP = sizedP.then((sized) =>
    Promise.all(
      ws.map(async (w, i) => {
        const buy = sized[i].buy;
        if (!buy || buy.expectedRaw === "0") return null;
        return quoteAtSize(w.mint, "buy", String(MID_SIZE_USDC * 1e6)).catch(() => null);
      }),
    ),
  );
  const marketP = company.kind === "public" ? getMarketState().catch(() => null) : Promise.resolve(null);
  // References start after the market state: the Pyth Pro and ticker references date their prices from the
  // same 4.8 MB Pyth session schedule, which is then held in memory, so a cold instance downloads it once and
  // not once per row.
  const refsP = marketP.then(() =>
    Promise.all(
      ws.map((w) =>
        getReference(w, company).catch((e) => {
          console.warn(`[company] ${w.symbol}: ${e instanceof Error ? e.message : String(e)}`);
          return null;
        }),
      ),
    ),
  );

  const [states, pools, market, refs, index] = await Promise.all([
    getMintStates(mints).catch(() => new Map()),
    poolsP,
    marketP,
    refsP,
    company.pythIndexProId ? getPythIndex(company.pythIndexProId).catch(() => null) : Promise.resolve(null),
  ]);

  const line = (sized: Awaited<typeof sizedP> | null, small: Awaited<typeof smallP> | null) => {
    const sizedByMint = new Map(ws.map((w, i) => [w.mint, sized?.[i]]));
    const midByMint = new Map<string, number | null>();
    const rows = ws.map((w, i) => {
      const state = states.get(w.mint) ?? null;
      const mid = unitPriceAt(small?.[i] ?? null, MID_SIZE_USDC, FEE_BPS, w.decimals, state?.multiplier ?? 1);
      midByMint.set(w.mint, mid);
      const computed = computeRow({
        wrapper: w,
        legal: legalFor(w.issuer, w.legalId),
        reference: refs[i] as Reference | null,
        state,
        pool: pools.get(w.mint) ?? null,
        buy: sized?.[i].buy ?? null,
        sell: sized?.[i].sell ?? null,
        sizeUsdc: size,
        feeBps: FEE_BPS,
        mid,
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
      mid: midByMint.get(row.wrapper.mint) ?? null,
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

    return (
      JSON.stringify({
        company,
        sort,
        size,
        feeBps: FEE_BPS,
        market: market ? { ...market, text: describeMarketState(market) } : null,
        index: index ? { price: index.price, asOf: index.asOf, label: "Pyth index, 24/7" } : null,
        rows: ranked,
        generatedAt: Math.floor(Date.now() / 1000),
        quoted: sized !== null,
      }) + "\n"
    );
  };

  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(ctl) {
        ctl.enqueue(enc.encode(line(null, null)));
        const sized = await sizedP;
        // Liquidity sinks rows above 5% impact, so its quoted line waits for the small quotes. No other sort key
        // depends on impact: there the impact line ranks the same as the quoted line and columns do not move.
        if (sort === "liquidity") ctl.enqueue(enc.encode(line(sized, await smallP)));
        else {
          ctl.enqueue(enc.encode(line(sized, null)));
          ctl.enqueue(enc.encode(line(sized, await smallP)));
        }
        ctl.close();
      },
    }),
    { headers: { "content-type": "application/x-ndjson" } },
  );
}
