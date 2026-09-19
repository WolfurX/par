import { NextResponse } from "next/server";
import { companyById, wrappersForCompany } from "@/lib/registry";
import { legalFor, companyNotes } from "@/lib/legal";
import { getMintStates } from "@/lib/rpc";
import { getReference, getPythIndex } from "@/lib/reference";
import { getPools } from "@/lib/pools";
import { getMids } from "@/lib/jupprice";
import { getMarketState, describeMarketState } from "@/lib/sessions";
import { rankRows, computeRow, type Intent } from "@/lib/ranking";
import type { Reference } from "@/lib/types";

export const dynamic = "force-dynamic";

const FEE_BPS = Number(process.env.FEE_BPS ?? 10);
const DEFAULT_SIZE = 1000;

// Company page composition. Row prices are Jupiter mids (one price call for all wrappers), not sized quotes;
// the label page quotes at size. Premium here is therefore labelled "mid".
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const company = companyById.get(id);
  if (!company) return NextResponse.json({ error: "unknown company" }, { status: 404 });
  const url = new URL(req.url);
  const intent = (url.searchParams.get("intent") ?? "hold") as Intent;
  const size = Number(url.searchParams.get("size") ?? DEFAULT_SIZE) || DEFAULT_SIZE;

  const ws = wrappersForCompany(id);
  const mints = ws.map((w) => w.mint);
  const [states, pools, mids, market] = await Promise.all([
    getMintStates(mints).catch(() => new Map()),
    getPools(mints).catch(() => new Map()),
    getMids(mints).catch(() => new Map()),
    company.kind === "public" ? getMarketState().catch(() => null) : Promise.resolve(null),
  ]);
  const refs = await Promise.all(ws.map((w) => getReference(w, company).catch(() => null)));
  const index = company.pythIndexProId ? await getPythIndex(company.pythIndexProId).catch(() => null) : null;

  const rows = ws.map((w, i) => {
    const state = states.get(w.mint) ?? null;
    const mid = mids.get(w.mint);
    const m = state?.multiplier ?? mid?.multiplier ?? 1;
    // Synthesize a size-neutral "quote" from the mid so computeRow can produce a premium; expectedRaw derived from the mid.
    let buy = null;
    if (mid) {
      const unitPrice = mid.usdPricePerUnit;
      const rawPrice = unitPrice * m;
      const netUsdc = size * (1 - FEE_BPS / 10_000);
      const outRaw = BigInt(Math.floor((netUsdc / rawPrice) * 10 ** w.decimals));
      buy = {
        mint: w.mint,
        side: "buy" as const,
        inputMint: "USDC",
        outputMint: w.mint,
        inAmountRaw: String(Math.round(size * 1e6)),
        outAmountRaw: outRaw.toString(),
        expectedRaw: outRaw.toString(),
        minimumRaw: outRaw.toString(),
        slippageBps: 0,
        priceImpactPct: 0,
        feeBps: FEE_BPS,
        feeAmountRaw: String(Math.round(size * 1e6 * (FEE_BPS / 10_000))),
        routeLabels: ["mid"],
        excludedDexes: [],
        quotedAt: mid.fetchedAt,
      };
    }
    const computed = computeRow({
      wrapper: w,
      legal: legalFor(w.issuer, w.legalId),
      reference: refs[i] as Reference | null,
      state,
      pool: pools.get(w.mint) ?? null,
      buy,
      sell: null,
      sizeUsdc: size,
      feeBps: FEE_BPS,
    });
    return computed;
  });

  const ranked = rankRows(rows, intent).map(({ row, rank }) => ({
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
  }));

  return NextResponse.json({
    company,
    intent,
    size,
    feeBps: FEE_BPS,
    market: market ? { ...market, text: describeMarketState(market) } : null,
    index: index ? { price: index.price, asOf: index.asOf, label: "Pyth index, 24/7" } : null,
    rows: ranked,
    generatedAt: Math.floor(Date.now() / 1000),
  });
}
