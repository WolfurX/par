// POST /api/send {signedTransactionBase64}
// Forwards a wallet-signed transaction to Helius (preflight on), waits up to 60 s for confirmation, then reads the
// landed balance deltas for the taker and the fee account from getTransaction.

import type { NextRequest } from "next/server";
import { JupiterError, sendSigned } from "@/lib/jupiter";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

function bad(message: string, status = 400, extra?: Record<string, unknown>) {
  return Response.json({ error: message, ...extra }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest) {
  let body: { signedTransactionBase64?: string };
  try {
    body = await request.json();
  } catch {
    return bad("body must be JSON");
  }
  const b64 = body.signedTransactionBase64;
  if (typeof b64 !== "string" || b64.length < 64 || b64.length > 4096) return bad("signedTransactionBase64 is required");
  try {
    const result = await sendSigned(b64);
    const status = result.status === "failed" ? 422 : result.status === "timeout" ? 202 : 200;
    return Response.json(result, { status, headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof JupiterError) return bad(e.code === "blocked" ? "Swap routing is not available for this address." : e.message, e.status, { code: e.code });
    return bad(e instanceof Error ? e.message : "send failed", 502);
  }
}
