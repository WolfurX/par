import type { Issuer, LegalLine } from "./types";

// Verified against issuer documents on 2026-09-16. Each entry links its sources; dates are the document dates we read.
// Copy rules: plain sentences, no adjectives, nothing that reads as a recommendation.

export const legalLines: Record<string, LegalLine> = {
  xstocks: {
    id: "xstocks",
    issuer: "xstocks",
    entity: "Backed Assets (JE) Limited, Jersey",
    form: "tracker certificate (bearer debt)",
    line:
      "A tracker certificate (bearer debt) of Backed Assets (JE) Limited, Jersey, backed 1:1 by the share held at a broker, with public proof of reserves. Not a share, no vote. Dividends are reinvested net of 30% withholding through the token multiplier. The issuer can freeze an account, pause all transfers and claw back tokens. No transfer fee. Redeem with Backed after KYC; not offered to US, UK, Canadian or Australian persons; the docs state a 5,000 USD minimum and the API states 1,000; fee 0 plus spread.",
    powers: ["freeze", "permanent delegate", "pause"],
    transferFeeBps: 0,
    redemption: "Redeem from your wallet with Backed after KYC (market sell or atomic RFQ), fee currently 0 plus spread.",
    excluded: ["US persons", "UK", "Canada", "Australia", "sanctioned persons"],
    sources: [
      { title: "xStocks product and legal overview", url: "https://docs.xstocks.fi/docs/product-legal-overview", date: "2026-09-16" },
      { title: "Backed base prospectus", url: "https://assets.backed.fi/legal-documentation", date: "2026-07-27" },
      { title: "Dividends and stock splits", url: "https://docs.xstocks.fi/docs/dividends-and-stock-splits", date: "2026-09-16" },
    ],
    holdScore: 6,
    redeemTier: 1,
  },
  ondo: {
    id: "ondo",
    issuer: "ondo",
    entity: "Ondo Global Markets (BVI) Limited",
    form: "structured note (debt)",
    line:
      "A structured note (debt) of Ondo Global Markets (BVI) Limited under Swiss-law sales terms, total return, secured through Ankura Trust as security and verification agent. No vote. The issuer can freeze an account and pause transfers; there is no clawback delegate on the stock tokens. No transfer fee. Redeem only after Ondo onboarding, open to institutions only as of September 2026; not offered to US or Canadian persons or sanctioned regions; retail not eligible in the EEA, UK, Singapore, Hong Kong or Switzerland. On Solana there is almost no pool liquidity.",
    powers: ["freeze", "pause"],
    transferFeeBps: 0,
    redemption: "Redeem after Ondo onboarding and KYC; institutions only today, retail on a waitlist.",
    excluded: ["US persons", "Canada", "sanctioned regions", "retail in EEA/UK/SG/HK/CH"],
    sources: [
      { title: "Ondo Stocks legal and regulatory", url: "https://docs.ondo.finance/ondo-stocks/legal-and-regulatory", date: "2026-09-16" },
      { title: "Eligibility", url: "https://docs.ondo.finance/ondo-stocks/eligibility", date: "2026-09-16" },
      { title: "Onboarding and KYC", url: "https://docs.ondo.finance/ondo-stocks/onboarding-and-kyc", date: "2026-09-16" },
    ],
    holdScore: 5,
    redeemTier: 1,
  },
  backpack: {
    id: "backpack",
    issuer: "backpack",
    entity: "Trek Nexus Markets Ltd, British Virgin Islands",
    form: "digital trust receipt",
    line:
      "A digital receipt of Trek Nexus Markets Ltd (BVI) for shares held in trust for Backpack's affiliate. In your wallet it carries no redemption right and, per the issuer's risk notice, may be worthless; it becomes a brokerage entitlement only after deposit into a KYC'd Backpack account, which is not offered in the US, UK, UAE or Japan. The issuer can freeze an account, pause the token, and move or burn your balance. No transfer fee. Dividends are reinvested through the token multiplier. About 0.50 USD to withdraw back on-chain; deposit is free.",
    powers: ["freeze", "permanent delegate", "pause"],
    transferFeeBps: 0,
    redemption: "Deposit the token to a KYC'd Backpack account (not US/UK/UAE/JP); it is redeemed on arrival into a brokerage entitlement.",
    excluded: ["US persons", "UK", "UAE", "Japan"],
    sources: [
      { title: "Tokenized Securities Issuer Terms (2026-06-10)", url: "https://support.backpack.exchange/legal/general-legal/user-agreement", date: "2026-06-10" },
      { title: "Tokenized securities overview", url: "https://support.backpack.exchange/backpack-securities/tokenized-securities", date: "2026-09-16" },
      { title: "Conversion flow", url: "https://support.backpack.exchange/backpack-securities/tokenized-securities/conversion-flow", date: "2026-09-16" },
    ],
    holdScore: 5,
    redeemTier: 2,
  },
  tessera: {
    id: "tessera",
    issuer: "tessera",
    entity: "Tessera issuer entity (Panama) per terms.tessera.pe",
    form: "loan participation token",
    line:
      "A loan participation token from a Tessera issuer entity (Panama, per terms.tessera.pe). Not equity in the company, no vote. It pays only if Tessera announces a liquidity event; the claim window is 90 days from the announced start (terms s.2.2) and unclaimed proceeds are forfeited. 0.2% is withheld on every sell or transfer. The issuer can freeze an account; there is no clawback delegate. Not for US or China persons.",
    powers: ["freeze"],
    transferFeeBps: 20,
    redemption: "Only after Tessera announces a liquidity event; pro-rata exit proceeds during a 90-day window, unclaimed amounts forfeited.",
    excluded: ["US persons", "China", "FATF grey and black list jurisdictions"],
    sources: [
      { title: "Tessera terms and conditions (revised 2026-08-28)", url: "https://terms.tessera.pe/", date: "2026-08-28" },
      { title: "How T-Tokens work", url: "https://docs.tessera.pe/overview/how-do-tessera-token-work", date: "2026-09-16" },
      { title: "Redemption", url: "https://docs.tessera.pe/features/redemption", date: "2026-09-16" },
    ],
    holdScore: 2,
    redeemTier: 3,
  },
  prestocks: {
    id: "prestocks",
    issuer: "prestocks",
    entity: "PreStocks (issuer entity not publicly readable as of 2026-09-16)",
    form: "token tracking an SPV position",
    line:
      "A token tracking an SPV's exposure to the company, issued by PreStocks; the issuer entity and terms were not publicly readable as of 2026-09-16. No ownership, vote or dividend rights. The issuer holds a permanent delegate (can move or burn your balance) and can freeze and pause. 1% is withheld on every transfer. No published redemption commitment: SpaceX listed in June 2026 and no SPACEX redemption has been announced.",
    powers: ["freeze", "permanent delegate", "pause"],
    transferFeeBps: 100,
    redemption: "No published commitment; the issuer has announced no redemption for any token, including SPACEX after the June 2026 listing.",
    excluded: ["US persons", "other ineligible persons per the site footer"],
    sources: [
      { title: "PreStocks site footer disclaimer", url: "https://prestocks.com/", date: "2026-09-16" },
      { title: "Anthropic and OpenAI on SPV transfers (CoinDesk, 2026-05-13)", url: "https://www.coindesk.com/markets/2026/05/13/anthropic-openai-tokens-plunge-nearly-40-as-ai-firms-warn-spv-transfers-are-invalid", date: "2026-05-13" },
    ],
    holdScore: 0,
    redeemTier: 3,
  },
};

/** Company-specific sentences appended to the issuer line. */
export const companyNotes: Record<string, string> = {
  openai: "OpenAI warned in May 2026 that it does not recognise SPV transfers of its shares.",
  anthropic: "Anthropic stated in May 2026 that transfers of its shares to SPVs are void under its transfer restrictions.",
  spcx: "SpaceX listed in June 2026 under the ticker SPCX.",
};

export function legalFor(issuer: Issuer, legalId?: string): LegalLine {
  return legalLines[legalId ?? issuer];
}

export const holdScoreTable = [
  { rule: "No transfer fee", points: 2 },
  { rule: "No permanent delegate", points: 1 },
  { rule: "Public proof of reserves", points: 1 },
  { rule: "Ordinary-course retail redemption", points: 2 },
  { rule: "No dated forfeiture window", points: 1 },
];
