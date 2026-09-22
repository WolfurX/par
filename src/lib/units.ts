// Unit math. Raw units are canonical everywhere; display applies the Token-2022 scaled UI multiplier.

export interface ScaledUiConfig {
  multiplier: number;
  newMultiplier: number;
  newMultiplierEffectiveTimestamp: number; // unix seconds, 0 when never scheduled
}

/** The multiplier in force now. Token-2022 never rewrites `multiplier`; the live value is `newMultiplier` once its timestamp has passed. */
export function effectiveMultiplier(cfg: ScaledUiConfig | null | undefined, nowSec = Math.floor(Date.now() / 1000)): number {
  if (!cfg) return 1;
  if (cfg.newMultiplierEffectiveTimestamp > 0 && nowSec >= cfg.newMultiplierEffectiveTimestamp) return cfg.newMultiplier;
  return cfg.multiplier;
}

export function rawToUnits(raw: bigint | string, decimals: number, multiplier = 1): number {
  const r = typeof raw === "bigint" ? raw : BigInt(raw);
  return (Number(r) / 10 ** decimals) * multiplier;
}

export function unitsToRaw(units: number, decimals: number, multiplier = 1): bigint {
  return BigInt(Math.floor((units / multiplier) * 10 ** decimals));
}

/** Price per displayed unit from a price per raw token. */
export function rawPriceToUnitPrice(rawPrice: number, multiplier: number): number {
  return rawPrice / multiplier;
}

export const USDC_DECIMALS = 6;
export function usdcToRaw(usdc: number): bigint {
  return BigInt(Math.round(usdc * 1e6));
}
export function rawToUsdc(raw: bigint | string): number {
  return Number(typeof raw === "bigint" ? raw : BigInt(raw)) / 1e6;
}

export function fmtUsd(n: number, digits = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function fmtPct(fraction: number, digits = 2): string {
  const s = (fraction * 100).toFixed(digits);
  return (fraction > 0 ? "+" : "") + s + "%";
}
export function fmtUnits(n: number, digits = 4): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}
export function fmtAge(ageSec: number | null): string {
  if (ageSec === null) return "time not published";
  if (ageSec < 90) return `${Math.max(0, Math.round(ageSec))} s old`;
  if (ageSec < 5400) return `${Math.round(ageSec / 60)} min old`;
  if (ageSec < 172800) return `${(ageSec / 3600).toFixed(1)} h old`;
  return `${Math.round(ageSec / 86400)} d old`;
}
