// Pure ranking and label math. No I/O. Formulas are published on /rules; keep this file and that page in step.
import type { LegalLine, MintState, PoolInfo, QuoteResult, Reference, Wrapper } from "./types";
import { rawToUnits, rawToUsdc } from "./units";

export type Intent = "price" | "liquidity" | "redeemable" | "terms";
export const INTENTS: { id: Intent; label: string; line: string }[] = [
  { id: "price", label: "Price", line: "Lowest premium to the issuer's reference at this size." },
  { id: "liquidity", label: "Liquidity", line: "Least round trip cost at this size; thin pools last." },
  { id: "redeemable", label: "Redeemable", line: "A redemption path exists, most ordinary first." },
  { id: "terms", label: "Terms", line: "Fewest issuer powers and fees." },
];

export interface RowInput {
  wrapper: Wrapper;
  legal: LegalLine;
  reference: Reference | null;
  state: MintState | null;
  pool: PoolInfo | null;
  /** Buy quote for the page size (USDC in). */
  buy: QuoteResult | null;
  /** Sell quote for exactly the expected amount of the buy. */
  sell: QuoteResult | null;
  /** USDC size the quotes were taken at. */
  sizeUsdc: number;
  feeBps: number;
  /** Unit price at MID_SIZE_USDC on the same path (unitPriceAt of a small buy quote), for impact. */
  mid: number | null;
}

export interface RowComputed {
  wrapper: Wrapper;
  legal: LegalLine;
  /** Price per displayed unit paid at size, before our fee is deducted from the input. */
  unitPrice: number | null;
  /** Price per raw token, for the multiplier detail line. */
  rawPrice: number | null;
  multiplier: number;
  reference: Reference | null;
  premium: number | null; // fraction
  premiumUsd: number | null; // S - S/(1+premium)
  impact: number | null; // fraction: unit price net of the issuer transfer fee over mid, minus 1, floored at 0
  expectedUnits: number | null;
  minimumUnits: number | null;
  feesInBps: number; // app + issuer transfer fee withheld on the pool leg
  feesOutBps: number; // app + issuer transfer fee
  roundTripUsdc: number | null; // sell proceeds - size
  roundTripPct: number | null;
  liquidityUsd: number;
  volume24hUsd: number;
  thin: boolean; // impact above 5% or no simulated route
  noLiquidity: boolean;
  belowMark: boolean; // pre-IPO token trading under its issuer mark
  routeLabels: string[];
  deliveryRatio: number | null;
  compare: { jupOutUnits: number | null; jupFeeBps: number | null; deltaUnits: number | null };
}

const THIN_IMPACT = 0.05;
const CHEAPEST_MIN_VOLUME = 1_000;
const CHEAPEST_MIN_LIQUIDITY = 25_000;
/** Size of the small buy quote whose unit price is the mid for impact. */
export const MID_SIZE_USDC = 10;

/**
 * Price per displayed unit paid for sizeUsdc through quote, net of our fee on the input. The sized price and the
 * small-size mid both go through here, so they carry the same Parsec fee and the same issuer transfer fee, and those
 * cancel in the impact ratio.
 */
export function unitPriceAt(quote: QuoteResult | null, sizeUsdc: number, feeBps: number, decimals: number, m: number): number | null {
  if (!quote || quote.expectedRaw === "0") return null;
  const outTokens = rawToUnits(quote.expectedRaw, decimals, 1); // raw tokens (no multiplier)
  return outTokens > 0 ? (sizeUsdc - sizeUsdc * (feeBps / 10_000)) / outTokens / m : null;
}

export function computeRow(i: RowInput): RowComputed {
  const m = i.state?.multiplier ?? 1;
  const dec = i.wrapper.decimals;
  const S = i.sizeUsdc;
  const liquidityUsd = i.pool?.liquidityUsd ?? 0;
  const volume24hUsd = i.pool?.volume24hUsd ?? 0;
  const noLiquidity = liquidityUsd < 1;

  let rawPrice: number | null = null;
  let unitPrice: number | null = null;
  let expectedUnits: number | null = null;
  let minimumUnits: number | null = null;
  let routeLabels: string[] = [];
  let deliveryRatio: number | null = null;

  if (i.buy && i.buy.expectedRaw !== "0") {
    unitPrice = unitPriceAt(i.buy, S, i.feeBps, dec, m);
    rawPrice = unitPrice != null ? unitPrice * m : null;
    expectedUnits = rawToUnits(i.buy.expectedRaw, dec, m);
    minimumUnits = rawToUnits(i.buy.minimumRaw, dec, m);
    routeLabels = i.buy.routeLabels;
    deliveryRatio = i.buy.deliveryRatio ?? null;
  }

  const R = i.reference?.price ?? null;
  const premium = unitPrice != null && R != null && R > 0 ? unitPrice / R - 1 : null;
  const premiumUsd = premium != null ? S - S / (1 + premium) : null;

  const transferFeeBps = i.state?.transferFeeBps ?? i.legal.transferFeeBps;
  const impact = unitPrice != null && i.mid != null && i.mid > 0 ? Math.max(0, unitPrice / i.mid - 1) : null;
  const feesInBps = i.feeBps + transferFeeBps;
  const feesOutBps = i.feeBps + transferFeeBps;

  let roundTripUsdc: number | null = null;
  let roundTripPct: number | null = null;
  if (i.sell && i.sell.expectedRaw !== "0") {
    const proceeds = rawToUsdc(i.sell.expectedRaw);
    roundTripUsdc = proceeds - S;
    roundTripPct = roundTripUsdc / S;
  }

  const isPrivate = i.wrapper.issuer === "tessera" || i.wrapper.issuer === "prestocks";
  const belowMark = isPrivate && premium != null && premium < 0;
  const thin = noLiquidity || unitPrice == null || (impact != null && impact > THIN_IMPACT);

  const jupOutUnits = i.buy?.jupOrderOutRaw ? rawToUnits(i.buy.jupOrderOutRaw, dec, m) : null;
  const compare = {
    jupOutUnits,
    jupFeeBps: i.buy?.jupOrderFeeBps ?? null,
    deltaUnits: jupOutUnits != null && expectedUnits != null ? jupOutUnits - expectedUnits : null,
  };

  return {
    wrapper: i.wrapper,
    legal: i.legal,
    unitPrice,
    rawPrice,
    multiplier: m,
    reference: i.reference,
    premium,
    premiumUsd,
    impact,
    expectedUnits,
    minimumUnits,
    feesInBps,
    feesOutBps,
    roundTripUsdc,
    roundTripPct,
    liquidityUsd,
    volume24hUsd,
    thin,
    noLiquidity,
    belowMark,
    routeLabels,
    deliveryRatio,
    compare,
  };
}

/** Sort rows for an intent. Returns a new array; each element gets its 1-based rank. */
export function rankRows(rows: RowComputed[], intent: Intent): { row: RowComputed; rank: number }[] {
  const byLiquidityDesc = (a: RowComputed, b: RowComputed) => b.liquidityUsd - a.liquidityUsd;
  const sinkNoLiquidity = (a: RowComputed, b: RowComputed) => Number(a.noLiquidity) - Number(b.noLiquidity);

  const sorted = [...rows].sort((a, b) => {
    const s = sinkNoLiquidity(a, b);
    if (s !== 0) return s;
    switch (intent) {
      case "liquidity": {
        const ta = a.thin ? 1 : 0;
        const tb = b.thin ? 1 : 0;
        if (ta !== tb) return ta - tb;
        const ra = a.roundTripPct ?? -Infinity;
        const rb = b.roundTripPct ?? -Infinity;
        if (ra !== rb) return rb - ra; // least negative first
        return byLiquidityDesc(a, b);
      }
      case "price": {
        const ga = a.volume24hUsd < CHEAPEST_MIN_VOLUME || a.liquidityUsd < CHEAPEST_MIN_LIQUIDITY ? 1 : 0;
        const gb = b.volume24hUsd < CHEAPEST_MIN_VOLUME || b.liquidityUsd < CHEAPEST_MIN_LIQUIDITY ? 1 : 0;
        if (ga !== gb) return ga - gb;
        const pa = a.premium ?? Infinity;
        const pb = b.premium ?? Infinity;
        if (pa !== pb) return pa - pb;
        return byLiquidityDesc(a, b);
      }
      case "terms": {
        if (a.legal.holdScore !== b.legal.holdScore) return b.legal.holdScore - a.legal.holdScore;
        return byLiquidityDesc(a, b);
      }
      case "redeemable": {
        if (a.legal.redeemTier !== b.legal.redeemTier) return a.legal.redeemTier - b.legal.redeemTier;
        return byLiquidityDesc(a, b);
      }
    }
  });
  return sorted.map((row, idx) => ({ row, rank: idx + 1 }));
}

export const intentNotes: Record<Intent, string> = {
  terms: "Ordered by the published hold score: no transfer fee, no permanent delegate, public proof of reserves, ordinary-course retail redemption, no dated forfeiture window. Ties by liquidity.",
  liquidity: "Ordered by round-trip cost at this size, least costly first. Rows with more than 5% price impact or no simulated route sink and are marked thin. The button is never disabled.",
  price: "Ordered by premium to the issuer's reference at this size. Rows with under 1,000 USD of daily volume or under 25,000 USD of liquidity sink. A pre-IPO token under its mark is not a payout: no redemption at the mark is enforceable.",
  redeemable: "Tier 1: redeem from your wallet after KYC. Tier 2: deposit to an exchange account. Tier 3: only after an issuer-announced event. Ties by liquidity.",
};
