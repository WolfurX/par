import { NextResponse } from "next/server";
import { companyById, wrapperByMint } from "@/lib/registry";
import { getHistory, type HistoryRange } from "@/lib/history";
import { getReference } from "@/lib/reference";

// Candles for the label chart, plus the reference level so the chart can draw today's reference as a line.
export async function GET(req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  const w = wrapperByMint.get(mint);
  if (!w) return NextResponse.json({ error: "unknown wrapper" }, { status: 404 });
  const company = companyById.get(w.companyId)!;
  const range: HistoryRange = new URL(req.url).searchParams.get("range") === "30d" ? "30d" : "7d";

  try {
    const [history, reference] = await Promise.all([
      getHistory(mint, range),
      getReference(w, company).catch(() => null),
    ]);
    return NextResponse.json(
      {
        symbol: w.symbol,
        candles: history.candles,
        reference: reference ? { price: reference.price, source: reference.source, ageSec: reference.ageSec } : null,
        pool: history.pool,
        source: history.source,
        fetchedAt: history.fetchedAt,
      },
      { headers: { "cache-control": "public, s-maxage=120, stale-while-revalidate=300" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
