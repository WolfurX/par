// GET  /api/tessera?user=<address> -> { registered, guard, code, rentLamports, rentAgeSec }
// POST /api/tessera { user }       -> the registration transaction, when the wallet is eligible.
// The guard must pass before anything is built: a Tessera program upgrade would change the
// instruction the user is asked to sign. Sanctions screening runs before any signable
// transaction is returned, the same gate /api/build applies.

import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { appCodeOwner, appReferralCode, buildRegistration, isRegistered, programGuard, registrationRent } from "@/lib/tessera";
import { screenAddress } from "@/lib/screening";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseUser(value: string | null): PublicKey | null {
  if (!value) return null;
  try {
    const key = new PublicKey(value.trim());
    return PublicKey.isOnCurve(key.toBytes()) ? key : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const user = parseUser(new URL(request.url).searchParams.get("user"));
  if (!user) return NextResponse.json({ error: "user must be a base58 wallet address" }, { status: 400 });

  const [guard, registered, rent] = await Promise.all([programGuard(), isRegistered(user), registrationRent()]);
  return NextResponse.json({ registered, guard, code: appReferralCode(), rentLamports: rent.lamports, rentAgeSec: rent.ageSec });
}

export async function POST(request: Request) {
  let body: { user?: string };
  try {
    body = (await request.json()) as { user?: string };
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  const user = parseUser(body.user ?? null);
  if (!user) return NextResponse.json({ error: "user must be a base58 wallet address" }, { status: 400 });

  const code = appReferralCode();
  const owner = appCodeOwner();
  if (!code || !owner) {
    return NextResponse.json({ error: "registration is not configured: TESSERA_REFERRAL_CODE and FEE_WALLET must be set" }, { status: 503 });
  }

  const guard = await programGuard();
  if (!guard.ok) {
    return NextResponse.json({ error: "Tessera program changed, registration paused", guard }, { status: 409 });
  }

  if (await isRegistered(user)) {
    return NextResponse.json({ error: "wallet is already registered with Tessera; registering again would overwrite its referrers", registered: true }, { status: 409 });
  }

  const screen = await screenAddress(user.toBase58());
  if (screen.blocked) {
    return NextResponse.json({ error: "Registration is not available for this address.", reason: screen.reason, sources: screen.sources }, { status: 403 });
  }

  try {
    const built = await buildRegistration({ user, code, codeOwner: owner });
    return NextResponse.json({ ...built, code, codeOwner: owner, guard });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
