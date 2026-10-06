import { Suspense } from "react";
import { connection } from "next/server";
import { describeMarketState, getMarketState } from "@/lib/sessions";
import Clock from "./Clock";

async function MarketText() {
  // The text depends on the clock, so it renders per request and never at build.
  await connection();
  const state = await getMarketState().catch(() => null);
  const text = state ? describeMarketState(state) : null;
  return `US market: ${text ? text.charAt(0).toLowerCase() + text.slice(1) : "unknown"}`;
}

export default function StatusStrip() {
  return (
    <div className="statusbar">
      <div className="statusbar-in">
        <span>
          <Suspense fallback={null}>
            <MarketText />
          </Suspense>
        </span>
        <Clock />
        <span className="pow">Powered by Jupiter</span>
      </div>
    </div>
  );
}
