import { NextRequest, NextResponse } from "next/server";
import { getHoldings } from "@/lib/holdings";

export async function GET(request: NextRequest) {
  const owner = request.nextUrl.searchParams.get("owner");
  if (!owner) {
    return NextResponse.json({ error: "missing owner query param" }, { status: 400 });
  }

  try {
    const holdings = await getHoldings(owner);
    return NextResponse.json(holdings);
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load holdings";
    const status = message === "invalid owner address" ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
