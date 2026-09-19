// Wallet sanctions screening. Required server-side before /api/build returns a
// transaction (Jupiter API licence s.7.3(b): the integrator must screen and block
// sanctioned wallets "in accordance with prevailing best market practice").
//
// Checks, in order: the local OFAC SDN Solana address set (src/lib/data/sdn-solana.json,
// refreshed by scripts/sdn-refresh.mjs; re-read whenever its mtime changes, so a daily
// refresh reaches a long-running server process without a restart, see getSdnInfo/
// ensureFreshSdn), then Chainalysis's public screening endpoint (only when
// CHAINALYSIS_API_KEY is set) and TRM's keyless screening endpoint, both with a 3 s
// timeout and a 24 h in-memory result cache. Neither API is complete on its own: verified
// 2026-09-16, TRM returned isSanctioned:false for two of the four OFAC Solana addresses,
// so the local SDN list is checked first and independently rather than trusted to the
// APIs alone.
//
// The address a caller passes in is never written to disk or logged; the 24 h cache is
// in-memory only and is cleared on process restart.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";

interface SdnData {
  generatedAt: number;
  count: number;
  sol: string[];
  all: Record<string, string[]>;
}

const SDN_PATH = path.join(process.cwd(), "src", "lib", "data", "sdn-solana.json");

const EMPTY_SDN: SdnData = { generatedAt: 0, count: 0, sol: [], all: {} };

// Read (not statically imported) so this works identically under plain Node (scripts,
// run via `node --env-file=.env.local scripts/...mjs`, which needs an import attribute
// for a bare JSON import) and under the Next.js Node runtime.
//
// Loaded lazily and re-checked by mtime on every screenAddress call (ensureFreshSdn),
// not just once at module init: scripts/sdn-refresh.mjs is meant to run on a daily cron
// against a long-running Next.js server process, and a load that only ever happened at
// process start would never see the refreshed file without a restart. The mtime check is
// a cheap stat(), not a re-read, so this costs nothing when the file is unchanged. If the
// file is missing (fresh checkout before the first refresh), fall back to an empty set
// rather than throwing at import time.
let sdn: SdnData = EMPTY_SDN;
let sdnSolSet = new Set<string>();
let loadedMtimeMs = -1;

function ensureFreshSdn(): void {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(SDN_PATH).mtimeMs;
  } catch {
    return; // no file on disk yet; keep whatever is already loaded (possibly EMPTY_SDN)
  }
  if (mtimeMs === loadedMtimeMs) return;
  try {
    sdn = JSON.parse(readFileSync(SDN_PATH, "utf8")) as SdnData;
    sdnSolSet = new Set<string>(sdn.sol);
    loadedMtimeMs = mtimeMs;
  } catch {
    // Read raced a concurrent write (sdn-refresh.mjs is not atomic); keep the previous
    // snapshot and retry the stat/read on the next call.
  }
}

ensureFreshSdn();

/** The currently loaded SDN snapshot's age, for a human or a monitoring check to see how stale the enforced list is. */
export function getSdnInfo(): { generatedAt: number; count: number; ageSec: number } {
  ensureFreshSdn();
  return { generatedAt: sdn.generatedAt, count: sdn.count, ageSec: Math.floor(Date.now() / 1000) - sdn.generatedAt };
}

export interface ScreeningResult {
  blocked: boolean;
  reason?: string;
  sources: string[];
}

const API_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Used instead of the 24h TTL when neither external API was actually reached (both
// checked:false, e.g. a timeout or network blip): a blind "not blocked, no data" verdict
// on a never-before-seen address shouldn't lock in for a full day with no retry.
const API_CACHE_TTL_UNCHECKED_MS = 5 * 60 * 1000;
const API_TIMEOUT_MS = 3000;

interface ApiCacheEntry {
  result: ScreeningResult;
  expiresAt: number;
}

const apiCache = new Map<string, ApiCacheEntry>();

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface ChainalysisResponse {
  identifications?: Array<{ category?: string; name?: string; description?: string; url?: string }>;
}

/** GET https://public.chainalysis.com/api/v1/address/<addr>. Skipped when no API key is configured. */
async function checkChainalysis(address: string): Promise<{ blocked: boolean; checked: boolean }> {
  const key = process.env.CHAINALYSIS_API_KEY;
  if (!key) return { blocked: false, checked: false };
  try {
    const res = await fetchWithTimeout(
      `https://public.chainalysis.com/api/v1/address/${encodeURIComponent(address)}`,
      { headers: { "X-API-Key": key } },
      API_TIMEOUT_MS,
    );
    if (!res.ok) return { blocked: false, checked: false };
    const data = (await res.json()) as ChainalysisResponse;
    const hits = Array.isArray(data.identifications) ? data.identifications : [];
    return { blocked: hits.length > 0, checked: true };
  } catch {
    return { blocked: false, checked: false };
  }
}

interface TrmScreeningRow {
  address: string;
  isSanctioned?: boolean;
}

/** Keyless POST https://api.trmlabs.com/public/v1/sanctions/screening, body [{ address }]. */
async function checkTrm(address: string): Promise<{ blocked: boolean; checked: boolean }> {
  try {
    const res = await fetchWithTimeout(
      "https://api.trmlabs.com/public/v1/sanctions/screening",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ address }]),
      },
      API_TIMEOUT_MS,
    );
    if (!res.ok) return { blocked: false, checked: false };
    const data = (await res.json()) as TrmScreeningRow[];
    const row = Array.isArray(data) ? data[0] : undefined;
    return { blocked: Boolean(row?.isSanctioned), checked: true };
  } catch {
    return { blocked: false, checked: false };
  }
}

export async function screenAddress(address: string): Promise<ScreeningResult> {
  try {
    new PublicKey(address);
  } catch {
    return { blocked: false, sources: ["invalid address format"] };
  }

  ensureFreshSdn();
  if (sdnSolSet.has(address)) {
    return { blocked: true, reason: "OFAC SDN digital currency address list", sources: ["ofac-sdn"] };
  }

  const cached = apiCache.get(address);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const [chainalysis, trm] = await Promise.all([checkChainalysis(address), checkTrm(address)]);

  const sources: string[] = [];
  let blocked = false;
  let reason: string | undefined;

  if (chainalysis.checked) {
    sources.push("chainalysis");
    if (chainalysis.blocked) {
      blocked = true;
      reason = "Chainalysis sanctions match";
    }
  } else {
    sources.push(process.env.CHAINALYSIS_API_KEY ? "chainalysis api unavailable" : "chainalysis skipped (no key)");
  }

  if (trm.checked) {
    sources.push("trm");
    if (trm.blocked && !blocked) {
      blocked = true;
      reason = "TRM sanctions match";
    }
  } else {
    sources.push("trm api unavailable");
  }

  const result: ScreeningResult = blocked ? { blocked, reason, sources } : { blocked, sources };
  const ttl = chainalysis.checked || trm.checked ? API_CACHE_TTL_MS : API_CACHE_TTL_UNCHECKED_MS;
  apiCache.set(address, { result, expiresAt: Date.now() + ttl });
  return result;
}
