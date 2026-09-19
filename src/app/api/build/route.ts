// POST /api/build {mint, side, amountRaw, taker, slippageBps?, liquidityUsd?}
// Validates the shape, then buildForUser does the rest in order: sanctions screening, a balance read (insufficient
// balance is reported from that read, never from a failed build), /build, simulation, compute unit sizing. Each of
// those runs once, inside buildForUser; this route only maps its errors to copy. The response carries the unsigned
// transaction and the simulated numbers; nothing from the server env other than the public fee account address.

import type { NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import type { Side } from "@/lib/types";
import { wrapperByMint } from "@/lib/registry";
import { buildForUser, JupiterError } from "@/lib/jupiter";

export const dynamic = "force-dynamic";

function bad(message: string, status = 400, extra?: Record<string, unknown>) {
  return Response.json({ error: message, ...extra }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest) {
  let body: { mint?: string; side?: Side; amountRaw?: string; taker?: string; slippageBps?: number; liquidityUsd?: number };
  try {
    body = await request.json();
  } catch {
    return bad("body must be JSON");
  }
  const { mint = "", side, amountRaw = "", taker = "", slippageBps, liquidityUsd } = body;
  if (!wrapperByMint.has(mint)) return bad("unknown mint; wrappers are pinned by address", 404);
  if (side !== "buy" && side !== "sell") return bad("side must be buy or sell");
  if (!/^\d+$/.test(amountRaw) || BigInt(amountRaw) <= BigInt(0)) return bad("amountRaw must be a positive integer in raw units");
  try {
    new PublicKey(taker);
  } catch {
    return bad("taker must be a valid public key");
  }
  if (slippageBps !== undefined && (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5000)) return bad("slippageBps must be an integer 1..5000");

  try {
    const built = await buildForUser({ mint, side, amountRaw, taker, slippageBps, liquidityUsd });
    return Response.json(built, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof JupiterError) {
      const message =
        e.code === "blocked"
          ? "Swap routing is not available for this address."
          : e.code === "insufficient_balance"
            ? side === "buy"
              ? "Insufficient USDC for this size."
              : "Insufficient token balance for this size."
            : e.message;
      return bad(message, e.status, { code: e.code, ...e.details });
    }
    return bad(e instanceof Error ? e.message : "build failed", 502);
  }
}
