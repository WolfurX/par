import { NextResponse } from "next/server";
import { buildCreateCode, codeOwner } from "@/lib/tessera";

export const dynamic = "force-dynamic";

// One-time setup: build the create_referral_code transaction for the fee wallet. The owner signs in the browser.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { owner?: string; code?: string };
  const owner = body.owner ?? "";
  const code = (body.code ?? process.env.TESSERA_REFERRAL_CODE ?? "").toUpperCase();
  if (!owner || owner !== process.env.FEE_WALLET) return NextResponse.json({ error: "owner must be the fee wallet" }, { status: 400 });
  if (!/^[A-Z0-9]{6,12}$/.test(code)) return NextResponse.json({ error: "code must be 6 to 12 letters or digits" }, { status: 400 });
  const existing = await codeOwner(code).catch(() => null);
  if (existing) return NextResponse.json({ error: `code ${code} already exists, owned by ${existing}` }, { status: 409 });
  const built = await buildCreateCode({ owner, code });
  return NextResponse.json({ ...built, code });
}
