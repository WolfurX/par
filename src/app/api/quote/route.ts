// GET /api/quote?mint&side&amount[&taker&slippageBps&liquidityUsd]
// Returns a QuoteResult plus a compare block against jup.ag's own /order path. Never cached: a stale quote is a wrong quote.

import type { NextRequest } from "next/server";
import type { Side } from "@/lib/types";
import { wrapperByMint, USDC_MINT } from "@/lib/registry";
import { getQuote, JupiterError, tokenBalanceRaw } from "@/lib/jupiter";

export const dynamic = "force-dynamic";

function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const mint = q.get("mint") ?? "";
  const side = q.get("side") as Side | null;
  const amount = q.get("amount") ?? q.get("amountRaw") ?? "";
  const taker = q.get("taker") ?? undefined;
  const slippageParam = q.get("slippageBps");
  const liquidityParam = q.get("liquidityUsd");

  if (!wrapperByMint.has(mint)) return bad("unknown mint; wrappers are pinned by address", 404);
  if (side !== "buy" && side !== "sell") return bad("side must be buy or sell");
  if (!/^\d+$/.test(amount) || BigInt(amount) <= BigInt(0)) return bad("amount must be a positive integer in raw units");
  const slippageBps = slippageParam ? Number(slippageParam) : undefined;
  if (slippageBps !== undefined && (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5000)) return bad("slippageBps must be an integer 1..5000");
  const liquidityUsd = liquidityParam ? Number(liquidityParam) : undefined;

  try {
    // Insufficient balance is a balance read, never a failed build; the quote then runs on a placeholder taker.
    let insufficient: { mint: string; haveRaw: string; needRaw: string } | undefined;
    if (taker) {
      const inputMint = side === "buy" ? USDC_MINT : mint;
      const have = await tokenBalanceRaw(taker, inputMint);
      if (have < BigInt(amount)) insufficient = { mint: inputMint, haveRaw: have.toString(), needRaw: amount };
    }
    const result = await getQuote({ mint, side, amountRaw: amount, taker, slippageBps, liquidityUsd });

    const ours = BigInt(result.expectedRaw);
    const jup = result.jupOrderOutRaw !== undefined ? BigInt(result.jupOrderOutRaw) : undefined;
    const compare = {
      // What jup.ag's /order path returns at this size, net of Jupiter's own fee on this pair.
      jupOrderOutRaw: result.jupOrderOutRaw,
      jupOrderFeeBps: result.jupOrderFeeBps,
      ourExpectedRaw: result.expectedRaw,
      ourFeeBps: result.feeBps,
      // ours minus jup.ag, in raw output units and in bps of jup.ag's figure; positive means this path delivers more.
      differenceRaw: jup !== undefined && ours > BigInt(0) ? (ours - jup).toString() : undefined,
      differenceBps: jup !== undefined && jup > BigInt(0) && ours > BigInt(0) ? Number(((ours - jup) * BigInt(10000)) / jup) : undefined,
      ageSec: result.jupOrderAgeSec,
      stale: result.jupOrderStale,
      routing: "Metis (Jupiter Swap API)",
    };
    return Response.json({ ...result, insufficient, compare }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof JupiterError) return bad(e.message, e.status);
    return bad(e instanceof Error ? e.message : "quote failed", 502);
  }
}
