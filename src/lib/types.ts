// Shared types. Read this before writing any module.

export type Issuer = "xstocks" | "ondo" | "backpack" | "tessera" | "prestocks";

export type CompanyKind = "public" | "private";

export interface Company {
  id: string; // url slug, e.g. "openai", "aapl"
  name: string; // "OpenAI", "Apple"
  ticker?: string; // listed ticker for public names, e.g. "AAPL", "SPCX"
  kind: CompanyKind;
  /** Pyth Hermes feed id (hex, no 0x) of the underlying equity feed, for the Core on-chain account. Public names only. */
  pythEquityFeedId?: string;
  /** Pyth Pro integer id of the underlying equity feed (Equity.US.<sym>/USD). */
  pythEquityProId?: number;
  /** Pyth Pro integer id of a 24/7 index feed (Pyth.Index.<sym>/USD), if one exists. */
  pythIndexProId?: number;
}

export interface Wrapper {
  mint: string; // pinned address; never resolve by symbol
  issuer: Issuer;
  symbol: string; // as the issuer names it: "AAPLx", "AAPLon", "AAPL.US", "tOpenAI", "OPENAI"
  name: string; // display name
  decimals: number;
  companyId: string;
  /** How the reference price for this row is found. */
  reference: ReferenceSource;
  /** Pyth Pro id of the wrapper's own 24/7 price feed (Crypto.<SYM>X/USD etc.), if one exists. */
  pythWrapperProId?: number;
  /** Pyth Pro id of the redemption-rate feed (Crypto.<SYM>X/<SYM>.RR), if one exists. */
  pythRedemptionRateProId?: number;
  /** Legal line id in legal.ts (defaults to the issuer). */
  legalId?: string;
}

export type ReferenceSource =
  | { kind: "pyth-core"; feedId: string; shard?: number } // underlying share price from the on-chain Pyth account
  | { kind: "backpack-external"; symbol: string } // e.g. "SPCX.US_USDC" with source=External
  | { kind: "tessera"; code: string } // rest-api.tessera.pe token-details, matched on "code" (tOpenAI)
  | { kind: "prestocks"; symbol: string } // prestocks.com/api/prestocks bulk, matched on "symbol" (OPENAI)
  | { kind: "xstocks-price-data"; symbol: string }; // api.xstocks.fi price-data quote, fallback for public names

export interface Reference {
  /** Price per share (public) or per displayed unit (pre-IPO mark). */
  price: number;
  currency: "USD";
  source: string; // human label: "Pyth Core AAPL account", "Tessera auction mark", ...
  sourceUrl?: string;
  asOf: number; // unix seconds of the upstream timestamp
  ageSec: number; // computed at response time
  stale: boolean; // true when served from the last-good cache after failures
  pythMark?: boolean; // show the Pyth attribution
}

export interface MintState {
  mint: string;
  program: "token" | "token-2022";
  decimals: number;
  supplyRaw: string;
  multiplier: number; // effective now
  multiplierChangesAt?: number; // unix seconds when newMultiplier takes effect, if in the future
  pendingMultiplier?: number;
  transferFeeBps: number;
  permanentDelegate?: string;
  freezeAuthority?: string;
  paused: boolean;
  pausable: boolean;
  transferHookProgram?: string | null; // null = extension present but no program
  transferHookAuthority?: string;
  defaultAccountFrozen: boolean;
  fetchedAt: number;
}

export type SessionName = "pre_market" | "regular" | "post_market" | "over_night" | "closed";

export interface MarketState {
  session: SessionName;
  isOpen: boolean; // regular session
  nextRegularOpenAt?: number; // unix seconds
  nextChangeAt?: number;
  source: string;
}

export interface PoolInfo {
  mint: string;
  liquidityUsd: number; // summed across pools
  volume24hUsd: number;
  topPool?: { dexId: string; pairAddress: string; quoteSymbol: string; liquidityUsd: number };
  fetchedAt: number;
}

export type Side = "buy" | "sell";

export interface QuoteRequest {
  mint: string;
  side: Side;
  /** USDC size in raw units (6 decimals) for buys; token size in raw units for sells. */
  amountRaw: string;
  taker?: string; // connected wallet, else a funded placeholder chosen by the module
  slippageBps?: number;
}

export interface QuoteResult {
  mint: string;
  side: Side;
  inputMint: string;
  outputMint: string;
  inAmountRaw: string;
  /** Jupiter outAmount, net of our fee. */
  outAmountRaw: string;
  /** Simulated token-account delta for the taker, when a simulation ran. */
  simulatedOutRaw?: string;
  /** min(outAmount, simulated) expressed for display. */
  expectedRaw: string;
  minimumRaw: string; // otherAmountThreshold
  slippageBps: number;
  priceImpactPct: number; // fraction, e.g. 0.002 = 0.2%
  feeBps: number;
  feeAmountRaw: string; // in the fee mint (USDC)
  routeLabels: string[]; // DEX labels in the route
  deliveryRatio?: number; // simulated / quoted, when both exist
  excludedDexes: string[];
  quotedAt: number; // unix seconds
  /** What jup.ag's own /order path would deliver at this size, for the Compare line. */
  jupOrderOutRaw?: string;
  jupOrderFeeBps?: number;
}

export interface LabelLine {
  key: string;
  label: string;
  value: string;
  detail?: string;
  pyth?: boolean;
}

export interface Holding {
  mint: string;
  wrapper?: Wrapper; // undefined when the mint is a wrapper we can label only from on-chain metadata
  balanceRaw: string;
  balanceUnits: number; // raw x multiplier / 10^dec
  state: MintState;
  powers: string; // one line, e.g. "freeze: yes · permanent delegate: yes · paused: no · transfer hook: none · transfer fee 0.5%"
  nextEvent?: { at?: number; text: string; sourceUrl?: string };
}

export interface LegalLine {
  id: string;
  issuer: Issuer;
  entity: string; // "Backed Assets (JE) Limited, Jersey"
  form: string; // "tracker certificate (bearer debt)"
  line: string; // the full "what you own" sentence set
  powers: string[]; // ["freeze", "permanent delegate", "pause"]
  transferFeeBps: number;
  redemption: string; // one sentence on the exit path
  excluded: string[]; // country or person classes the issuer excludes
  sources: { title: string; url: string; date: string }[];
  holdScore: number; // published table on /rules
  redeemTier: 1 | 2 | 3;
}
