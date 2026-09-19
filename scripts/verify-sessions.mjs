// Verifies src/lib/sessions.ts against the live Pyth and Backpack endpoints.
// Run: cd par && node --env-file=.env.local scripts/verify-sessions.mjs
import { getMarketState, describeMarketState } from "../src/lib/sessions.ts";

function fmtNy(unixSec) {
  if (unixSec === undefined) return "(none)";
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${dtf.format(new Date(unixSec * 1000))} ET (${unixSec})`;
}

async function fetchRawSchedule() {
  const res = await fetch("https://history.pyth-lazer.dourolabs.app/history/v1/symbols?query=Equity.US.AAPL/USD");
  const json = await res.json();
  const entry = json.find((e) => e.symbol === "Equity.US.AAPL/USD" && e.state === "stable");
  return entry.market_session_schedule;
}

async function fetchBackpackRaw() {
  const [sessRes, holRes] = await Promise.all([
    fetch("https://api.backpack.exchange/api/v1/market-sessions"),
    fetch("https://api.backpack.exchange/api/v1/market-holidays"),
  ]);
  return { sessions: await sessRes.json(), holidays: await holRes.json() };
}

async function main() {
  console.log("=== parsed schedule (Pyth, symbol=Equity.US.AAPL/USD) ===");
  const raw = await fetchRawSchedule();
  for (const [k, v] of Object.entries(raw)) {
    console.log(`${k}:`);
    const [tz, days, exceptions] = v.split(";");
    console.log(`  tz: ${tz}`);
    console.log(`  Mon..Sun: ${days}`);
    console.log(`  exceptions: ${exceptions}`);
  }

  console.log("\n=== Backpack cross-check source data ===");
  const bp = await fetchBackpackRaw();
  const bpRegular = bp.sessions.find((s) => s.name === "US_EQUITIES_REGULAR");
  console.log("US_EQUITIES_REGULAR:", JSON.stringify(bpRegular));
  console.log(`market-holidays entries: ${bp.holidays.length} (US_EQUITIES: ${bp.holidays.filter((h) => h.market === "US_EQUITIES").length})`);

  console.log("\n=== current state (live now) ===");
  const nowSec = Math.floor(Date.now() / 1000);
  const stateNow = await getMarketState();
  console.log(`now: ${fmtNy(nowSec)}`);
  console.log("state:", JSON.stringify(stateNow, null, 2));
  console.log("label:", describeMarketState(stateNow, nowSec));
  if (stateNow.nextRegularOpenAt !== undefined) {
    const mins = Math.round((stateNow.nextRegularOpenAt - nowSec) / 60);
    console.log(`minutes to next regular open: ${mins} (${fmtNy(stateNow.nextRegularOpenAt)})`);
  } else {
    console.log("minutes to next regular open: n/a (already in regular session)");
  }

  console.log("\n=== weekend check (Saturday 2026-09-19 12:00 ET, forced) ===");
  // 2026-09-19 12:00 ET = 16:00 UTC = 1789574400
  const weekendSec = Math.floor(Date.UTC(2026, 8, 19, 16, 0, 0) / 1000);
  const weekendState = await getMarketState(weekendSec);
  console.log(`at: ${fmtNy(weekendSec)}`);
  console.log("state:", JSON.stringify(weekendState, null, 2));
  console.log("label:", describeMarketState(weekendState, weekendSec));

  console.log("\n=== weekend overnight check (Sunday 2026-09-20 21:00 ET, forced) ===");
  // The one weekend moment that isn't just "closed": Pyth's over_night token is "2000-2400" on
  // Sunday, so Sunday evening should already be in the over_night session, not closed.
  // 2026-09-20 21:00 ET (EDT, UTC-4) = 2026-09-21 01:00 UTC
  const sundayEveningSec = Math.floor(Date.UTC(2026, 8, 21, 1, 0, 0) / 1000);
  const sundayEveningState = await getMarketState(sundayEveningSec);
  console.log(`at: ${fmtNy(sundayEveningSec)}`);
  console.log("state:", JSON.stringify(sundayEveningState, null, 2));
  console.log("label:", describeMarketState(sundayEveningState, sundayEveningSec));
  const sundayEveningOk = sundayEveningState.session === "over_night" && sundayEveningState.isOpen === false;
  console.log(`expected session="over_night", isOpen=false: ${sundayEveningOk ? "PASS" : "FAIL"}`);

  console.log("\n=== pre-market check (a weekday 07:00 ET, forced) ===");
  // Tuesday 2026-09-22 07:00 ET = 11:00 UTC
  const preSec = Math.floor(Date.UTC(2026, 8, 22, 11, 0, 0) / 1000);
  const preState = await getMarketState(preSec);
  console.log(`at: ${fmtNy(preSec)}`);
  console.log("state:", JSON.stringify(preState, null, 2));
  console.log("label:", describeMarketState(preState, preSec));

  console.log("\n=== regular session check (a weekday 12:00 ET, forced) ===");
  const regSec = Math.floor(Date.UTC(2026, 8, 22, 16, 0, 0) / 1000);
  const regState = await getMarketState(regSec);
  console.log(`at: ${fmtNy(regSec)}`);
  console.log("state:", JSON.stringify(regState, null, 2));
  console.log("label:", describeMarketState(regState, regSec));
}

main().catch((err) => {
  console.error("verify-sessions failed:", err);
  process.exit(1);
});
