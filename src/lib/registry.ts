import type { Company, Wrapper } from "./types";

// Every mint below was read on-chain on 2026-09-16 (getAccountInfo jsonParsed: program, decimals, metadata name).
// Same-symbol fakes exist for AAPLx and AAPLon. Add nothing here without an on-chain check.
// Entries marked TODO are filled by scripts/registry-fill.mjs from the issuer APIs and verified on-chain.

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const PYTH_PUSH_ORACLE_PROGRAM = "pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT";
// PDA([u16le(1), feedId]) shard-1 accounts, verified with scripts/registry-fill.mjs 2026-09-19:
// AAPL D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW, TSLA FQB8c4zB8Emrp9W8bmyk6GanCLq4aRytHYPDAnaEpq9z,
// NVDA 5VETJ8h3p4JrESYrzhjTDAWPEjDjfcnduqe9CjxgqBNd, SPY CRDaGwcVnKdRNRtx6fjHtvrBgKM5U55AhbqBWhtPMDA,
// MU 4eMZuk9khRP5uMnk5f1i1uA8joNMcHtBwDGCstW65bai. SPCX has none on shards 0-20 (checked 2026-09-16).
export const PYTH_CORE_SHARD = 1;

export const companies: Company[] = [
  { id: "aapl", name: "Apple", ticker: "AAPL", kind: "public", pythEquityFeedId: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688", pythEquityProId: 922 },
  { id: "tsla", name: "Tesla", ticker: "TSLA", kind: "public", pythEquityFeedId: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1", pythEquityProId: 1435 },
  { id: "nvda", name: "Nvidia", ticker: "NVDA", kind: "public", pythEquityFeedId: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593", pythEquityProId: 1314 },
  { id: "spy", name: "SPDR S&P 500 ETF", ticker: "SPY", kind: "public", pythEquityFeedId: "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5", pythEquityProId: 1398 },
  { id: "mu", name: "Micron", ticker: "MU", kind: "public", pythEquityFeedId: "152244dc24665ca7dd3f257b8f442dc449b6346f48235b7b229268cb770dda2d", pythEquityProId: 1298 },
  { id: "spcx", name: "SpaceX", ticker: "SPCX", kind: "public", pythEquityProId: 3314 }, // listed June 2026; no Core account on shards 0 to 20 (checked 2026-09-16)
  { id: "openai", name: "OpenAI", kind: "private", pythIndexProId: 3619 },
  { id: "kalshi", name: "Kalshi", kind: "private" },
  { id: "anthropic", name: "Anthropic", kind: "private", pythIndexProId: 3618 }, // coming_soon on 2026-09-16
  { id: "polymarket", name: "Polymarket", kind: "private" },
  { id: "figure", name: "Figure AI", kind: "private" },
  { id: "neuralink", name: "Neuralink", kind: "private" },
  { id: "anduril", name: "Anduril", kind: "private" },
];

export const wrappers: Wrapper[] = [
  // xStocks (Backed): Token-2022, 8 decimals, no transfer fee, permanent delegate, pausable, scaled UI amount
  { mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", issuer: "xstocks", symbol: "AAPLx", name: "Apple xStock", decimals: 8, companyId: "aapl", reference: { kind: "pyth-core", feedId: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688" }, pythWrapperProId: 1792, pythRedemptionRateProId: 1791 },
  { mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", issuer: "xstocks", symbol: "TSLAx", name: "Tesla xStock", decimals: 8, companyId: "tsla", reference: { kind: "pyth-core", feedId: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1" }, pythWrapperProId: 1847, pythRedemptionRateProId: 1846 },
  { mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", issuer: "xstocks", symbol: "NVDAx", name: "Nvidia xStock", decimals: 8, companyId: "nvda", reference: { kind: "pyth-core", feedId: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593" }, pythWrapperProId: 1833, pythRedemptionRateProId: 1832 },
  { mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", issuer: "xstocks", symbol: "SPYx", name: "SP500 xStock", decimals: 8, companyId: "spy", reference: { kind: "pyth-core", feedId: "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5" }, pythWrapperProId: 1843, pythRedemptionRateProId: 1842 },
  { mint: "XsQLZycSZ7QnBBdBXQaTbQdiUcbRqjNJgyBGAMzhHav", issuer: "xstocks", symbol: "MUx", name: "Micron Technology xStock", decimals: 8, companyId: "mu", reference: { kind: "pyth-core", feedId: "152244dc24665ca7dd3f257b8f442dc449b6346f48235b7b229268cb770dda2d" } }, // mint from api.xstocks.fi, verified on-chain 2026-09-19
  { mint: "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8", issuer: "xstocks", symbol: "SPCXx", name: "SpaceX xStock", decimals: 8, companyId: "spcx", reference: { kind: "xstocks-price-data", symbol: "SPCXx" } }, // mint from api.xstocks.fi, verified on-chain 2026-09-19; no Pyth Core account for SPCX

  // Ondo: Token-2022, 9 decimals, no transfer fee, no permanent delegate, pausable, scaled UI amount. Near-zero Solana liquidity.
  { mint: "123mYEnRLM2LLYsJW3K6oyYh8uP1fngj732iG638ondo", issuer: "ondo", symbol: "AAPLon", name: "Apple (Ondo Tokenized)", decimals: 9, companyId: "aapl", reference: { kind: "pyth-core", feedId: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688" }, pythWrapperProId: 3132 },
  { mint: "KeGv7bsfR4MheC1CkmnAVceoApjrkvBhHYjWb67ondo", issuer: "ondo", symbol: "TSLAon", name: "Tesla (Ondo Tokenized)", decimals: 9, companyId: "tsla", reference: { kind: "pyth-core", feedId: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1" }, pythWrapperProId: 3128 },
  { mint: "gEGtLTPNQ7jcg25zTetkbmF7teoDLcrfTnQfmn2ondo", issuer: "ondo", symbol: "NVDAon", name: "Nvidia (Ondo Tokenized)", decimals: 9, companyId: "nvda", reference: { kind: "pyth-core", feedId: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593" }, pythWrapperProId: 3127 },
  { mint: "k18WJUULWheRkSpSquYGdNNmtuE2Vbw1hpuUi92ondo", issuer: "ondo", symbol: "SPYon", name: "SPDR S&P 500 ETF (Ondo Tokenized)", decimals: 9, companyId: "spy", reference: { kind: "pyth-core", feedId: "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5" } },

  // Backpack .US (Trek Nexus Markets Ltd, BVI): Token-2022, 6 decimals, no transfer fee, permanent delegate, pausable, scaled UI amount
  { mint: "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb", issuer: "backpack", symbol: "SPCX.US", name: "SpaceX - Backpack Securities", decimals: 6, companyId: "spcx", reference: { kind: "backpack-external", symbol: "SPCX.US_USDC" }, pythWrapperProId: 3329, pythRedemptionRateProId: 3328 },
  { mint: "MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1", issuer: "backpack", symbol: "MU.US", name: "Micron Technology, Inc. - Backpack Securities", decimals: 6, companyId: "mu", reference: { kind: "pyth-core", feedId: "152244dc24665ca7dd3f257b8f442dc449b6346f48235b7b229268cb770dda2d" } },
  { mint: "AAPLEDt8RpzPgXyhvFzkMBofvFSQw9gpeMCoUdPdLnB8", issuer: "backpack", symbol: "AAPL.US", name: "Apple Inc. - Backpack Securities", decimals: 6, companyId: "aapl", reference: { kind: "pyth-core", feedId: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688" } }, // deposit/withdraw disabled on Backpack; may have no pool
  { mint: "TSLAqBbv4CNCnzWFeB7LmydAyEiNMJtve7DYKLpdK4S", issuer: "backpack", symbol: "TSLA.US", name: "Tesla, Inc. - Backpack Securities", decimals: 6, companyId: "tsla", reference: { kind: "pyth-core", feedId: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1" } },
  { mint: "NVDAVuiB7hwd3m5Wa1JuHNovPaPG6BH1QNztbKFxNjv", issuer: "backpack", symbol: "NVDA.US", name: "NVIDIA Corporation - Backpack Securities", decimals: 6, companyId: "nvda", reference: { kind: "pyth-core", feedId: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593" } },
  { mint: "SPYBo66VJPFjh1pXMb9Le53kDYWTK1zzYVDeVRWtsbi", issuer: "backpack", symbol: "SPY.US", name: "State Street SPDR S&P 500 ETF Trust - Backpack Securities", decimals: 6, companyId: "spy", reference: { kind: "pyth-core", feedId: "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5" } }, // mint from api.backpack.exchange/api/v1/assets, verified on-chain 2026-09-19; deposit/withdraw disabled

  // Tessera T-Tokens: Token-2022, 9 decimals, 20 bps transfer fee, no hook, no delegate
  { mint: "oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ", issuer: "tessera", symbol: "tOpenAI", name: "T-OpenAI", decimals: 9, companyId: "openai", reference: { kind: "tessera", code: "tOpenAI" } },
  { mint: "TKLSidmLVt3cqGaaodG8tyRzoANfQwoh67AccjmubeZ", issuer: "tessera", symbol: "tKalshi", name: "T-Kalshi", decimals: 9, companyId: "kalshi", reference: { kind: "tessera", code: "tKalshi" } },
  { mint: "TSPXcLV76s6V2zDiZQ18kBfcbnjaE2ZzNT3ga2Pd99v", issuer: "tessera", symbol: "tSpaceX", name: "T-SpaceX", decimals: 9, companyId: "spcx", reference: { kind: "tessera", code: "tSpaceX" } },

  // PreStocks: Token-2022, 9 decimals, 100 bps transfer fee (50 until epoch 1039), permanent delegate, pausable, scaled UI amount (OPENAI x1.4861347, SPACEX x5)
  { mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", issuer: "prestocks", symbol: "OPENAI", name: "OpenAI PreStocks", decimals: 9, companyId: "openai", reference: { kind: "prestocks", symbol: "OPENAI" } },
  { mint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua", issuer: "prestocks", symbol: "KALSHI", name: "Kalshi PreStocks", decimals: 9, companyId: "kalshi", reference: { kind: "prestocks", symbol: "KALSHI" } },
  { mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw", issuer: "prestocks", symbol: "ANTHROPIC", name: "Anthropic PreStocks", decimals: 9, companyId: "anthropic", reference: { kind: "prestocks", symbol: "ANTHROPIC" } },
  { mint: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh", issuer: "prestocks", symbol: "SPACEX", name: "SpaceX PreStocks", decimals: 9, companyId: "spcx", reference: { kind: "prestocks", symbol: "SPACEX" } },
  { mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP", issuer: "prestocks", symbol: "POLYMARKET", name: "Polymarket PreStocks", decimals: 9, companyId: "polymarket", reference: { kind: "prestocks", symbol: "POLYMARKET" } },
  { mint: "PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd", issuer: "prestocks", symbol: "FIGUREAI", name: "Figure AI PreStocks", decimals: 9, companyId: "figure", reference: { kind: "prestocks", symbol: "FIGUREAI" } },
  { mint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S", issuer: "prestocks", symbol: "NEURALINK", name: "Neuralink PreStocks", decimals: 9, companyId: "neuralink", reference: { kind: "prestocks", symbol: "NEURALINK" } },
  { mint: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB", issuer: "prestocks", symbol: "ANDURIL", name: "Anduril PreStocks", decimals: 9, companyId: "anduril", reference: { kind: "prestocks", symbol: "ANDURIL" } },
];

export const companyById = new Map(companies.map((c) => [c.id, c]));
export const wrapperByMint = new Map(wrappers.map((w) => [w.mint, w]));
export function wrappersForCompany(companyId: string): Wrapper[] {
  return wrappers.filter((w) => w.companyId === companyId);
}

/** Update authorities used to label wrapper mints we do not list (portfolio view). */
export const issuerUpdateAuthorities: Record<string, "xstocks" | "ondo"> = {
  "5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq": "xstocks",
  "9foMHsSDq7nMg4WPusSz9eY7tyxyukqborA8GyU5cUxD": "ondo",
};
export const issuerMintPrefixes: { prefix: string; issuer: "prestocks" }[] = [{ prefix: "Pre", issuer: "prestocks" }];
export const backpackAuthority = "2cVYpagTt7ZGc3mmTXBa7fAznUtx5DUu6aCq8uVDaf4a"; // freeze, delegate, pause and hook authority on every .US mint
