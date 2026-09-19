// US equity market session state, from Pyth's keyless symbol metadata (market_session_schedule).
// Cross-checked against Backpack's market-sessions/market-holidays endpoints; on disagreement we
// report Pyth's answer and note it in `source`. Schedule is cached in-memory for 1 h with a
// last-good fallback (Pyth's schedule barely changes; a fetch failure should not blank the label).
//
// Deviation from CLAUDE.md's generic "three failures in a row serve the last good value for 60 s"
// rule, deliberate: below 3 consecutive failures we still fall back to the last-good schedule
// immediately (not just after the 3rd) rather than surfacing an error, because the NYSE calendar
// is near-static and a single fetch blip should never blank the session label. The 60 s part of
// the rule is honored literally: once 3 failures have accrued in a row, we stop re-attempting the
// network on every call and retry at most once per 60 s while serving the stale copy.

import type { MarketState, SessionName } from "./types";

const PYTH_HISTORY_URL = "https://history.pyth-lazer.dourolabs.app/history/v1/symbols";
const PYTH_HISTORY_FALLBACK_URL = "https://pyth.dourolabs.app/v1/symbols";
// One representative NYSE equity feed. Pyth publishes the same market_session_schedule shape
// (regular/pre/post/overnight + NYSE holiday exceptions) across all Equity.US.* symbols; there is
// no per-company US equity calendar to reconcile, so we read it once from AAPL's entry.
const SYMBOL_QUERY = "Equity.US.AAPL/USD";

const BACKPACK_SESSIONS_URL = "https://api.backpack.exchange/api/v1/market-sessions";
const BACKPACK_HOLIDAYS_URL = "https://api.backpack.exchange/api/v1/market-holidays";

const SCHEDULE_CACHE_TTL_SEC = 3600;
const STALE_RETRY_INTERVAL_SEC = 60;
const NY_TZ = "America/New_York";

type SessionKind = "regular" | "pre_market" | "post_market" | "over_night";
const SESSION_KINDS: SessionKind[] = ["regular", "pre_market", "post_market", "over_night"];

interface RawSchedule {
  regular: string;
  pre_market: string;
  post_market: string;
  over_night: string;
}

interface ParsedDaySchedule {
  /** Monday..Sunday raw tokens ("C", "O", or "HHMM-HHMM"[&"HHMM-HHMM"]*). */
  weekday: [string, string, string, string, string, string, string];
  /** "MMDD" -> override token, for NYSE holidays and early/late closes. */
  exceptions: Map<string, string>;
}

type ParsedSchedule = Record<SessionKind, ParsedDaySchedule>;

interface ScheduleEntry {
  raw: RawSchedule;
  parsed: ParsedSchedule;
  fetchedAt: number; // unix seconds
}

let scheduleCache: ScheduleEntry | null = null;
let lastGoodSchedule: ScheduleEntry | null = null;
let consecutiveFailures = 0;
let lastFailureAttemptAt = 0; // unix seconds of the most recent failed fetch attempt

// ---- schedule string parsing ----

function parseScheduleString(s: string): ParsedDaySchedule {
  const parts = s.split(";");
  const days = (parts[1] ?? "").split(",").map((t) => t.trim());
  if (days.length !== 7) {
    throw new Error(`sessions: expected 7 weekday tokens, got ${days.length} in "${s}"`);
  }
  const exceptions = new Map<string, string>();
  const exceptionList = parts[2] ?? "";
  if (exceptionList.length > 0) {
    for (const ex of exceptionList.split(",")) {
      const slash = ex.indexOf("/");
      if (slash < 0) continue;
      exceptions.set(ex.slice(0, slash), ex.slice(slash + 1));
    }
  }
  return { weekday: days as ParsedDaySchedule["weekday"], exceptions };
}

function parseAllSessions(raw: RawSchedule): ParsedSchedule {
  return {
    regular: parseScheduleString(raw.regular),
    pre_market: parseScheduleString(raw.pre_market),
    post_market: parseScheduleString(raw.post_market),
    over_night: parseScheduleString(raw.over_night),
  };
}

/** "C" -> closed, "O" -> open all day, "HHMM-HHMM"[&...] -> minute-of-day intervals, end may be 1440 (=2400, next midnight). */
function parseToken(token: string): Array<[number, number]> {
  if (token === "C") return [];
  if (token === "O") return [[0, 1440]];
  return token.split("&").map((seg) => {
    const [a, b] = seg.split("-");
    return [hhmmToMin(a), hhmmToMin(b)];
  });
}

function hhmmToMin(hhmm: string): number {
  const h = parseInt(hhmm.slice(0, 2), 10);
  const m = parseInt(hhmm.slice(2, 4), 10);
  return h * 60 + m;
}

function mmddKey(mo: number, d: number): string {
  return `${String(mo).padStart(2, "0")}${String(d).padStart(2, "0")}`;
}

// ---- NY calendar-date and timezone-offset helpers (no moment/luxon) ----

/** Day-of-week for a plain Y-M-D calendar date, timezone-independent. 0=Mon..6=Sun. */
function weekdayMon0(y: number, mo: number, d: number): number {
  const utcDay = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  return (utcDay + 6) % 7;
}

function addDaysYMD(y: number, mo: number, d: number, days: number): { y: number; mo: number; d: number } {
  const dt = new Date(Date.UTC(y, mo - 1, d + days));
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** UTC offset (minutes, e.g. -240 for EDT) America/New_York is at for wall-clock y-mo-d hh:mm. */
function nyOffsetMinutes(y: number, mo: number, d: number, hh: number, mm: number): number {
  const guessMs = Date.UTC(y, mo - 1, d, hh, mm);
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: NY_TZ, timeZoneName: "longOffset", hour: "2-digit" });
  const tzName = dtf.formatToParts(new Date(guessMs)).find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(tzName);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0));
}

function nyWallToUtcMs(y: number, mo: number, d: number, hh: number, mm: number): number {
  return Date.UTC(y, mo - 1, d, hh, mm) - nyOffsetMinutes(y, mo, d, hh, mm) * 60000;
}

function nyMinutesToUtcMs(y: number, mo: number, d: number, minutesFromMidnight: number): number {
  return nyWallToUtcMs(y, mo, d, Math.floor(minutesFromMidnight / 60), minutesFromMidnight % 60);
}

function nyPartsFromMs(ms: number): { y: number; mo: number; d: number; hh: number; mm: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  let hh = parseInt(get("hour"), 10);
  if (hh === 24) hh = 0; // some locales format midnight as "24"
  return { y: parseInt(get("year"), 10), mo: parseInt(get("month"), 10), d: parseInt(get("day"), 10), hh, mm: parseInt(get("minute"), 10) };
}

// ---- schedule -> concrete UTC intervals ----

function tokenForDate(sched: ParsedDaySchedule, y: number, mo: number, d: number): string {
  const key = mmddKey(mo, d);
  const override = sched.exceptions.get(key);
  if (override !== undefined) return override;
  return sched.weekday[weekdayMon0(y, mo, d)];
}

function intervalsForDateUtc(sched: ParsedDaySchedule, y: number, mo: number, d: number): Array<[number, number]> {
  const token = tokenForDate(sched, y, mo, d);
  return parseToken(token).map(([startMin, endMin]) => {
    const startUtc = nyMinutesToUtcMs(y, mo, d, startMin);
    if (endMin >= 1440) {
      const next = addDaysYMD(y, mo, d, 1);
      return [startUtc, nyMinutesToUtcMs(next.y, next.mo, next.d, endMin - 1440)];
    }
    return [startUtc, nyMinutesToUtcMs(y, mo, d, endMin)];
  });
}

interface TimelineEntry {
  start: number; // utc ms
  end: number; // utc ms
  session: SessionKind;
}

function buildTimeline(schedule: ParsedSchedule, centerY: number, centerMo: number, centerD: number, daysBehind: number, daysAhead: number): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (let offset = -daysBehind; offset <= daysAhead; offset++) {
    const { y, mo, d } = addDaysYMD(centerY, centerMo, centerD, offset);
    for (const kind of SESSION_KINDS) {
      for (const [start, end] of intervalsForDateUtc(schedule[kind], y, mo, d)) {
        out.push({ start, end, session: kind });
      }
    }
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

function resolveState(timeline: TimelineEntry[], nowMs: number): { session: SessionName; isOpen: boolean; nextRegularOpenAt?: number; nextChangeAt?: number } {
  const current = timeline.find((iv) => iv.start <= nowMs && nowMs < iv.end);
  const session: SessionName = current ? current.session : "closed";
  const isOpen = session === "regular";

  const nextChangeAt = current ? Math.floor(current.end / 1000) : (() => {
    const next = timeline.find((iv) => iv.start > nowMs);
    return next ? Math.floor(next.start / 1000) : undefined;
  })();

  let nextRegularOpenAt: number | undefined;
  if (!isOpen) {
    const nextRegular = timeline.find((iv) => iv.session === "regular" && iv.start > nowMs);
    nextRegularOpenAt = nextRegular ? Math.floor(nextRegular.start / 1000) : undefined;
  }

  return { session, isOpen, nextRegularOpenAt, nextChangeAt };
}

// ---- fetching + caching the schedule ----

function pickEntry(json: unknown): { market_session_schedule: RawSchedule } | null {
  if (!Array.isArray(json)) return null;
  const entry = json.find(
    (e) => e && typeof e === "object" && (e as { symbol?: unknown }).symbol === SYMBOL_QUERY && (e as { state?: unknown }).state === "stable"
  ) as { market_session_schedule?: RawSchedule } | undefined;
  if (!entry?.market_session_schedule) return null;
  return entry as { market_session_schedule: RawSchedule };
}

async function fetchRawSchedule(): Promise<RawSchedule> {
  const qs = `?query=${encodeURIComponent(SYMBOL_QUERY)}`;
  for (const base of [PYTH_HISTORY_URL, PYTH_HISTORY_FALLBACK_URL]) {
    try {
      const res = await fetch(base + qs, { next: { revalidate: SCHEDULE_CACHE_TTL_SEC } });
      if (!res.ok) continue;
      const entry = pickEntry(await res.json());
      if (entry) return entry.market_session_schedule;
    } catch {
      // try the next host
    }
  }
  throw new Error("sessions: could not fetch market_session_schedule from Pyth (both hosts failed)");
}

async function getSchedule(): Promise<ScheduleEntry> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (scheduleCache && nowSec - scheduleCache.fetchedAt < SCHEDULE_CACHE_TTL_SEC) {
    return scheduleCache;
  }
  // 3 failures in a row: stop hitting the network on every call, retry at most once per 60 s.
  if (consecutiveFailures >= 3 && lastGoodSchedule && nowSec - lastFailureAttemptAt < STALE_RETRY_INTERVAL_SEC) {
    return lastGoodSchedule;
  }
  try {
    const raw = await fetchRawSchedule();
    const entry: ScheduleEntry = { raw, parsed: parseAllSessions(raw), fetchedAt: nowSec };
    scheduleCache = entry;
    lastGoodSchedule = entry;
    consecutiveFailures = 0;
    return entry;
  } catch (err) {
    consecutiveFailures++;
    lastFailureAttemptAt = nowSec;
    if (lastGoodSchedule) return lastGoodSchedule;
    throw err;
  }
}

// ---- Backpack cross-check ----

interface BackpackSession {
  name: string;
  startWeekday: number; // 1=Mon..7=Sun
  endWeekday: number;
  startTime: string; // "HH:MM:SS"
  endTime: string;
}

interface BackpackHoliday {
  date: string; // "YYYY-MM-DD"
  startTime: string;
  endTime: string;
  market: string;
}

function hmsToMin(hms: string): number {
  const [h, m] = hms.split(":");
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

/** Backpack's own regular-session open/closed for `nowMs`, or null if the cross-check couldn't be fetched. */
async function fetchBackpackRegularOpen(nowMs: number): Promise<boolean | null> {
  try {
    const [sessRes, holRes] = await Promise.all([
      fetch(BACKPACK_SESSIONS_URL, { next: { revalidate: SCHEDULE_CACHE_TTL_SEC } }),
      fetch(BACKPACK_HOLIDAYS_URL, { next: { revalidate: SCHEDULE_CACHE_TTL_SEC } }),
    ]);
    if (!sessRes.ok || !holRes.ok) return null;
    const sessions = (await sessRes.json()) as BackpackSession[];
    const holidays = (await holRes.json()) as BackpackHoliday[];
    const regular = sessions.find((s) => s.name === "US_EQUITIES_REGULAR");
    if (!regular) return null;

    const { y, mo, d, hh, mm } = nyPartsFromMs(nowMs);
    const weekdayIso = weekdayMon0(y, mo, d) + 1; // 1=Mon..7=Sun, matches Backpack's numbering
    const minutesNow = hh * 60 + mm;
    let open =
      weekdayIso >= regular.startWeekday &&
      weekdayIso <= regular.endWeekday &&
      minutesNow >= hmsToMin(regular.startTime) &&
      minutesNow < hmsToMin(regular.endTime);

    const dateStr = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    for (const h of holidays) {
      if (h.market !== "US_EQUITIES" || h.date !== dateStr) continue;
      const startMin = hmsToMin(h.startTime);
      const endMin = h.endTime === "23:59:59" ? 1440 : hmsToMin(h.endTime);
      if (minutesNow >= startMin && minutesNow < endMin) open = false; // every listed window is a closure/early-close
    }
    return open;
  } catch {
    return null;
  }
}

// ---- public API ----

export async function getMarketState(nowSec?: number): Promise<MarketState> {
  const nowMs = (nowSec ?? Math.floor(Date.now() / 1000)) * 1000;
  const schedule = await getSchedule();
  const { y, mo, d } = nyPartsFromMs(nowMs);
  const timeline = buildTimeline(schedule.parsed, y, mo, d, 2, 10);
  const state = resolveState(timeline, nowMs);

  const ageSec = Math.max(0, Math.floor(Date.now() / 1000) - schedule.fetchedAt);
  let source = `Pyth market_session_schedule (${SYMBOL_QUERY}), ${ageSec}s old`;

  const backpackOpen = await fetchBackpackRegularOpen(nowMs);
  if (backpackOpen !== null && backpackOpen !== state.isOpen) {
    source += `; disagreement: Backpack reports ${backpackOpen ? "open" : "closed"}`;
  }

  return {
    session: state.session,
    isOpen: state.isOpen,
    nextRegularOpenAt: state.nextRegularOpenAt,
    nextChangeAt: state.nextChangeAt,
    source,
  };
}

function fmtNyWeekdayTime(unixSec: number): string {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: NY_TZ, weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = dtf.formatToParts(new Date(unixSec * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${get("hour")}:${get("minute")}`;
}

const SESSION_LABEL: Record<SessionName, string> = {
  regular: "Regular session",
  pre_market: "Pre-market",
  post_market: "Post-market",
  over_night: "Overnight session",
  closed: "Closed",
};

/** Human label for a MarketState, e.g. "Pre-market, opens in 34 min" or "Closed until Monday 09:30 ET". */
export function describeMarketState(state: MarketState, nowSec = Math.floor(Date.now() / 1000)): string {
  if (state.session === "regular") return SESSION_LABEL.regular;
  const base = SESSION_LABEL[state.session];
  if (state.nextRegularOpenAt === undefined) return base;
  const minsToOpen = Math.round((state.nextRegularOpenAt - nowSec) / 60);
  if (minsToOpen <= 0) return base;
  if (minsToOpen < 180) return `${base}, opens in ${minsToOpen} min`;
  return `${base} until ${fmtNyWeekdayTime(state.nextRegularOpenAt)} ET`;
}
