import type { Company, Wrapper } from "./types";

// Every mint below was read on-chain on 2026-09-16, or on the date given in its block comment (getAccountInfo jsonParsed: program, decimals, metadata name).
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
  { id: "fwdi", name: "Forward Industries", ticker: "FWDI", kind: "public" },
  { id: "djt", name: "Trump Media", ticker: "DJT", kind: "public" },
  { id: "bot", name: "RoboStrategy", ticker: "BOT", kind: "public" },
  { id: "crcl", name: "Circle Internet Group", ticker: "CRCL", kind: "public", pythEquityFeedId: "92b8527aabe59ea2b12230f7b532769b133ffb118dfbd48ff676f14b273f1365" },
  { id: "qqq", name: "Invesco QQQ Trust", ticker: "QQQ", kind: "public", pythEquityFeedId: "9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d" },
  { id: "coin", name: "Coinbase", ticker: "COIN", kind: "public", pythEquityFeedId: "fee33f2a978bf32dd6b662b65ba8083c6773b494f8401194ec1870c640860245" },
  { id: "hood", name: "Robinhood", ticker: "HOOD", kind: "public", pythEquityFeedId: "306736a4035846ba15a3496eed57225b64cc19230a50d14f3ed20fd7219b7849" },
  { id: "gld", name: "SPDR Gold Shares", ticker: "GLD", kind: "public", pythEquityFeedId: "e190f467043db04548200354889dfe0d9d314c08b8d4e62fabf4d5a3140fecca" },
  { id: "mstr", name: "Strategy", ticker: "MSTR", kind: "public", pythEquityFeedId: "e1e80251e5f5184f2195008382538e847fafc36f751896889dd3d1b1f6111f09" },
  { id: "googl", name: "Alphabet", ticker: "GOOGL", kind: "public", pythEquityFeedId: "5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6" },
  { id: "meta", name: "Meta Platforms", ticker: "META", kind: "public", pythEquityFeedId: "78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe" },
  { id: "msft", name: "Microsoft", ticker: "MSFT", kind: "public", pythEquityFeedId: "d0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1" },
  { id: "amzn", name: "Amazon", ticker: "AMZN", kind: "public", pythEquityFeedId: "b5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a" },
  { id: "strc", name: "Strategy Variable Rate Preferred (STRC)", ticker: "STRC", kind: "public", pythEquityFeedId: "27c7bbc9755d847f7fc63620c2edcc6a91d2c0c67a28c7999907b59c505b3c17" },
  { id: "gme", name: "GameStop", ticker: "GME", kind: "public", pythEquityFeedId: "6f9cd89ef1b7fd39f667101a91ad578b6c6ace4579d5f7f285a4b06aa4504be6" },
  { id: "mcd", name: "McDonald's", ticker: "MCD", kind: "public", pythEquityFeedId: "d3178156b7c0f6ce10d6da7d347952a672467b51708baaf1a57ffe1fb005824a" },
  { id: "avgo", name: "Broadcom", ticker: "AVGO", kind: "public", pythEquityFeedId: "d0c9aef79b28308b256db7742a0a9b08aaa5009db67a52ea7fa30ed6853f243b" },
  { id: "pltr", name: "Palantir", ticker: "PLTR", kind: "public", pythEquityFeedId: "11a70634863ddffb71f2b11f2cff29f73f3db8f6d0b78c49f2b5f4ad36e885f0" },
  { id: "brkb", name: "Berkshire Hathaway B", ticker: "BRK.B", kind: "public", pythEquityFeedId: "e21c688b7fc65b4606a50f3635f466f6986db129bf16979875d160f9c508e8c7" },
  { id: "skhy", name: "SK Hynix", ticker: "SKHY", kind: "public", pythEquityFeedId: "e5725db9661fa7df89131c9d7fd85c30122523a1e864d03986911342a43cd47c" },
  { id: "dram", name: "Roundhill Memory ETF", ticker: "DRAM", kind: "public", pythEquityFeedId: "71a19a2d91626d9d184ba85c4a9d21289640013a7dacc113d007847ea1a09ec8" },
  { id: "nke", name: "Nike", ticker: "NKE", kind: "public", pythEquityFeedId: "67649450b4ca4bfff97cbaf96d2fd9e40f6db148cb65999140154415e4378e14" },
  { id: "ibm", name: "IBM", ticker: "IBM", kind: "public", pythEquityFeedId: "cfd44471407f4da89d469242546bb56f5c626d5bef9bd8b9327783065b43c3ef" },
  { id: "pfe", name: "Pfizer", ticker: "PFE", kind: "public", pythEquityFeedId: "0704ad7547b3dfee329266ee53276349d48e4587cb08264a2818288f356efd1d" },
  { id: "pusa", name: "Powerus", ticker: "PUSA", kind: "public" }, // no Pyth equity feed (Hermes query empty, 2026-10-06)
  { id: "sndk", name: "Sandisk", ticker: "SNDK", kind: "public", pythEquityFeedId: "c86a1f20cd7d5d07932baea30bcd8e479b775c4f51f82526bf1de6dc79fa3f76" },
  { id: "intc", name: "Intel", ticker: "INTC", kind: "public", pythEquityFeedId: "c1751e085ee292b8b3b9dd122a135614485a201c35dfc653553f0e28c1baf3ff" },
  { id: "lmt", name: "Lockheed Martin", ticker: "LMT", kind: "public", pythEquityFeedId: "880d96a272d5ccbb3cd6f6aacb881a996cb4976b3f252b58c595cd2a418b6ea9" },
  { id: "baba", name: "Alibaba", ticker: "BABA", kind: "public", pythEquityFeedId: "72bc23b1d0afb1f8edef20b7fb60982298993161bc0fd749587d6f60cd1ee9a3" },
  { id: "ttwo", name: "Take-Two Interactive", ticker: "TTWO", kind: "public", pythEquityFeedId: "782a6a261306f01ab2ad004062a2832107360eefdcf8c83223e0ff7ca7ebde8d" },
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
  // Added 2026-10-06, each mint read on-chain that day; backpack-external where the equity feed has no Core account on shard 1.
  { mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1", issuer: "xstocks", symbol: "CRCLx", name: "Circle xStock", decimals: 8, companyId: "crcl", reference: { kind: "backpack-external", symbol: "CRCL.US_USDC" } },
  { mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ", issuer: "xstocks", symbol: "QQQx", name: "Nasdaq xStock", decimals: 8, companyId: "qqq", reference: { kind: "pyth-core", feedId: "9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d" } },
  { mint: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu", issuer: "xstocks", symbol: "COINx", name: "Coinbase xStock", decimals: 8, companyId: "coin", reference: { kind: "backpack-external", symbol: "COIN.US_USDC" } },
  { mint: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg", issuer: "xstocks", symbol: "HOODx", name: "Robinhood xStock", decimals: 8, companyId: "hood", reference: { kind: "backpack-external", symbol: "HOOD.US_USDC" } },
  { mint: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re", issuer: "xstocks", symbol: "GLDx", name: "Gold xStock", decimals: 8, companyId: "gld", reference: { kind: "backpack-external", symbol: "GLD.US_USDC" } },
  { mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ", issuer: "xstocks", symbol: "MSTRx", name: "MicroStrategy xStock", decimals: 8, companyId: "mstr", reference: { kind: "pyth-core", feedId: "e1e80251e5f5184f2195008382538e847fafc36f751896889dd3d1b1f6111f09" } },
  { mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", issuer: "xstocks", symbol: "GOOGLx", name: "Alphabet xStock", decimals: 8, companyId: "googl", reference: { kind: "pyth-core", feedId: "5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6" } },
  { mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu", issuer: "xstocks", symbol: "METAx", name: "Meta xStock", decimals: 8, companyId: "meta", reference: { kind: "pyth-core", feedId: "78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe" } },
  { mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX", issuer: "xstocks", symbol: "MSFTx", name: "Microsoft xStock", decimals: 8, companyId: "msft", reference: { kind: "pyth-core", feedId: "d0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1" } },
  { mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", issuer: "xstocks", symbol: "AMZNx", name: "Amazon.com xStock", decimals: 8, companyId: "amzn", reference: { kind: "pyth-core", feedId: "b5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a" } },
  { mint: "Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH", issuer: "xstocks", symbol: "STRCx", name: "Strategy PP Variable xStock", decimals: 8, companyId: "strc", reference: { kind: "backpack-external", symbol: "STRC.US_USDC" } },
  { mint: "Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc", issuer: "xstocks", symbol: "GMEx", name: "Gamestop xStock", decimals: 8, companyId: "gme", reference: { kind: "backpack-external", symbol: "GME.US_USDC" } },
  { mint: "XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2", issuer: "xstocks", symbol: "MCDx", name: "McDonald's xStock", decimals: 8, companyId: "mcd", reference: { kind: "backpack-external", symbol: "MCD.US_USDC" } },
  { mint: "XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo", issuer: "xstocks", symbol: "AVGOx", name: "Broadcom xStock", decimals: 8, companyId: "avgo", reference: { kind: "backpack-external", symbol: "AVGO.US_USDC" } },
  { mint: "XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4", issuer: "xstocks", symbol: "PLTRx", name: "Palantir xStock", decimals: 8, companyId: "pltr", reference: { kind: "backpack-external", symbol: "PLTR.US_USDC" } },
  { mint: "Xs6B6zawENwAbWVi7w92rjazLuAr5Az59qgWKcNb45x", issuer: "xstocks", symbol: "BRK.Bx", name: "Berkshire Hathaway xStock", decimals: 8, companyId: "brkb", reference: { kind: "backpack-external", symbol: "BRK.B.US_USDC" } },
  { mint: "XshPgPdXFRWB8tP1j82rebb2Q9rPgGX37RuqzohmArM", issuer: "xstocks", symbol: "INTCx", name: "Intel xStock", decimals: 8, companyId: "intc", reference: { kind: "pyth-core", feedId: "c1751e085ee292b8b3b9dd122a135614485a201c35dfc653553f0e28c1baf3ff" } },

  // Ondo: Token-2022, 9 decimals, no transfer fee, no permanent delegate, pausable, scaled UI amount. No market on 2026-10-06 (AAPLon 1.8K USD, SPYon 133 USD, TSLAon and NVDAon no pair), so every row carries market: "none".
  { mint: "123mYEnRLM2LLYsJW3K6oyYh8uP1fngj732iG638ondo", issuer: "ondo", symbol: "AAPLon", name: "Apple (Ondo Tokenized)", decimals: 9, companyId: "aapl", reference: { kind: "pyth-core", feedId: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688" }, pythWrapperProId: 3132, market: "none" },
  { mint: "KeGv7bsfR4MheC1CkmnAVceoApjrkvBhHYjWb67ondo", issuer: "ondo", symbol: "TSLAon", name: "Tesla (Ondo Tokenized)", decimals: 9, companyId: "tsla", reference: { kind: "pyth-core", feedId: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1" }, pythWrapperProId: 3128, market: "none" },
  { mint: "gEGtLTPNQ7jcg25zTetkbmF7teoDLcrfTnQfmn2ondo", issuer: "ondo", symbol: "NVDAon", name: "Nvidia (Ondo Tokenized)", decimals: 9, companyId: "nvda", reference: { kind: "pyth-core", feedId: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593" }, pythWrapperProId: 3127, market: "none" },
  { mint: "k18WJUULWheRkSpSquYGdNNmtuE2Vbw1hpuUi92ondo", issuer: "ondo", symbol: "SPYon", name: "SPDR S&P 500 ETF (Ondo Tokenized)", decimals: 9, companyId: "spy", reference: { kind: "pyth-core", feedId: "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5" }, market: "none" },

  // Backpack .US (Trek Nexus Markets Ltd, BVI): Token-2022, 6 decimals, no transfer fee, permanent delegate, pausable, scaled UI amount
  { mint: "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb", issuer: "backpack", symbol: "SPCX.US", name: "SpaceX - Backpack Securities", decimals: 6, companyId: "spcx", reference: { kind: "backpack-external", symbol: "SPCX.US_USDC" }, pythWrapperProId: 3329, pythRedemptionRateProId: 3328 },
  { mint: "MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1", issuer: "backpack", symbol: "MU.US", name: "Micron Technology, Inc. - Backpack Securities", decimals: 6, companyId: "mu", reference: { kind: "pyth-core", feedId: "152244dc24665ca7dd3f257b8f442dc449b6346f48235b7b229268cb770dda2d" } },
  { mint: "AAPLEDt8RpzPgXyhvFzkMBofvFSQw9gpeMCoUdPdLnB8", issuer: "backpack", symbol: "AAPL.US", name: "Apple Inc. - Backpack Securities", decimals: 6, companyId: "aapl", reference: { kind: "pyth-core", feedId: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688" }, market: "none" }, // no market: deposits disabled at Backpack, no DEX pool (2026-10-06)
  { mint: "TSLAqBbv4CNCnzWFeB7LmydAyEiNMJtve7DYKLpdK4S", issuer: "backpack", symbol: "TSLA.US", name: "Tesla, Inc. - Backpack Securities", decimals: 6, companyId: "tsla", reference: { kind: "pyth-core", feedId: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1" }, market: "none" }, // no market: deposits disabled at Backpack, no DEX pool (2026-10-06)
  { mint: "NVDAVuiB7hwd3m5Wa1JuHNovPaPG6BH1QNztbKFxNjv", issuer: "backpack", symbol: "NVDA.US", name: "NVIDIA Corporation - Backpack Securities", decimals: 6, companyId: "nvda", reference: { kind: "pyth-core", feedId: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593" }, market: "none" }, // no market: deposits disabled at Backpack, no DEX pool (2026-10-06)
  { mint: "SPYBo66VJPFjh1pXMb9Le53kDYWTK1zzYVDeVRWtsbi", issuer: "backpack", symbol: "SPY.US", name: "State Street SPDR S&P 500 ETF Trust - Backpack Securities", decimals: 6, companyId: "spy", reference: { kind: "pyth-core", feedId: "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5" }, market: "none" }, // mint from api.backpack.exchange/api/v1/assets, verified on-chain 2026-09-19; deposit/withdraw disabled; no market, no DEX pool on 2026-10-06
  { mint: "FWDtiB5fXHdVAewPqvHPL2dh4aBC1C6GacQbePoQXKjz", issuer: "backpack", symbol: "FWDI.US", name: "Forward Industries, Inc. - Backpack Securities", decimals: 6, companyId: "fwdi", reference: { kind: "backpack-external", symbol: "FWDI.US_USDC" } }, // mint from api.backpack.exchange/api/v1/assets, verified on-chain 2026-09-23; no Pyth Core account on shard 1 (shard 0 last published 2026-07-22)
  { mint: "DJTu7vi8norVzdVAffgvb39VP7wjKeTsgaMBJrzfxvoF", issuer: "backpack", symbol: "DJT.US", name: "Trump Media & Technology Group Corp. Common Stock - Backpack Securities", decimals: 6, companyId: "djt", reference: { kind: "backpack-external", symbol: "DJT.US_USDC" } }, // mint from api.backpack.exchange/api/v1/assets, verified on-chain 2026-09-23; no Pyth Core account on shard 1
  { mint: "BoTx8y9ynfdxf5ZjWtCoBVkff52qKA82ysaLU8ZM6d8T", issuer: "backpack", symbol: "BOT.US", name: "RoboStrategy - Backpack Securities", decimals: 6, companyId: "bot", reference: { kind: "backpack-external", symbol: "BOT.US_USDC" } }, // mint from api.backpack.exchange/api/v1/assets, verified on-chain 2026-09-23; no Pyth Core account on shard 1
  // Added 2026-10-06, each mint read on-chain that day; backpack-external where the equity feed has no Core account on shard 1.
  { mint: "HooDYv5RewLRiMLnEVq3VJqdqxhuE6c5eYvqejMC3e9A", issuer: "backpack", symbol: "HOOD.US", name: "Robinhood Markets - Backpack Securities", decimals: 6, companyId: "hood", reference: { kind: "backpack-external", symbol: "HOOD.US_USDC" } },
  { mint: "MSTRdWXMeZxdE8osAQy3fA4rvTY5rgummDSMEx6U7Nz", issuer: "backpack", symbol: "MSTR.US", name: "Strategy - Backpack Securities", decimals: 6, companyId: "mstr", reference: { kind: "pyth-core", feedId: "e1e80251e5f5184f2195008382538e847fafc36f751896889dd3d1b1f6111f09" } },
  { mint: "SKHYhSjuRWHgikq8eRKbtBbpABgJSkd7ytQV14i9EQ3", issuer: "backpack", symbol: "SKHY.US", name: "SK Hynix - Backpack Securities", decimals: 6, companyId: "skhy", reference: { kind: "backpack-external", symbol: "SKHY.US_USDC" } },
  { mint: "DRAMjSWR7HRfJKjRkvQWYL2bcaejaVhuxEcjf4pAY4Cw", issuer: "backpack", symbol: "DRAM.US", name: "Roundhill Memory ETF - Backpack Securities", decimals: 6, companyId: "dram", reference: { kind: "backpack-external", symbol: "DRAM.US_USDC" } },
  { mint: "NKEda5nHhNGgjrE9nDdMvaEmkmJ96qqxzBVZEcKmjSg", issuer: "backpack", symbol: "NKE.US", name: "NIKE - Backpack Securities", decimals: 6, companyId: "nke", reference: { kind: "backpack-external", symbol: "NKE.US_USDC" } },
  { mint: "BMKdM4yUxX12moFqVk195k7coMbaybd4RUKCUdm7D1Sk", issuer: "backpack", symbol: "IBM.US", name: "International Business Machines - Backpack Securities", decimals: 6, companyId: "ibm", reference: { kind: "backpack-external", symbol: "IBM.US_USDC" } },
  { mint: "PFER6ENqP8r8NF3CqVt4mFowxsin3V5MLidBNQFCC3x", issuer: "backpack", symbol: "PFE.US", name: "Pfizer - Backpack Securities", decimals: 6, companyId: "pfe", reference: { kind: "backpack-external", symbol: "PFE.US_USDC" } },
  { mint: "PUSAG1stksTcAoK9MjinEHUwAYRJsbovywYCk37m6hy", issuer: "backpack", symbol: "PUSA.US", name: "Powerus Corporation - Backpack Securities", decimals: 6, companyId: "pusa", reference: { kind: "backpack-external", symbol: "PUSA.US_USDC" } },
  { mint: "SNDKbwMUQvZhnLnxLduradgLHG5KrPuKwpnrkkGRhfH", issuer: "backpack", symbol: "SNDK.US", name: "Sandisk - Backpack Securities", decimals: 6, companyId: "sndk", reference: { kind: "pyth-core", feedId: "c86a1f20cd7d5d07932baea30bcd8e479b775c4f51f82526bf1de6dc79fa3f76" } },
  { mint: "iNTCy1qTsUEZQe3DSocLz1ZXXai34Gdw8THQh5rxFaF", issuer: "backpack", symbol: "INTC.US", name: "Intel - Backpack Securities", decimals: 6, companyId: "intc", reference: { kind: "pyth-core", feedId: "c1751e085ee292b8b3b9dd122a135614485a201c35dfc653553f0e28c1baf3ff" } },
  { mint: "LMT3i1BHgixFqPUgcyteJhnEz2dpy9i3cYy4pi9BoeV", issuer: "backpack", symbol: "LMT.US", name: "Lockheed Martin - Backpack Securities", decimals: 6, companyId: "lmt", reference: { kind: "backpack-external", symbol: "LMT.US_USDC" } },
  { mint: "BABANGA4JE7Kkam4nTrALAwAVgsNJUuFJnnkF7S16BZp", issuer: "backpack", symbol: "BABA.US", name: "Alibaba Group Holding - Backpack Securities", decimals: 6, companyId: "baba", reference: { kind: "backpack-external", symbol: "BABA.US_USDC" } },
  { mint: "TTWofwAge91oFhZs7kpQdyrVRkmevgM88xijGvQFbKo", issuer: "backpack", symbol: "TTWO.US", name: "Take-Two Interactive Software - Backpack Securities", decimals: 6, companyId: "ttwo", reference: { kind: "backpack-external", symbol: "TTWO.US_USDC" } },

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
/** Rows with a market today: the company list, the matrix and the command line. Holdings, legal and the wrapper page go by mint or wrappersForCompany and still see every row. */
export function listedWrappersForCompany(companyId: string): Wrapper[] {
  return wrappersForCompany(companyId).filter((w) => w.market !== "none");
}

/** Update authorities used to label wrapper mints we do not list (portfolio view). */
export const issuerUpdateAuthorities: Record<string, "xstocks" | "ondo"> = {
  "5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq": "xstocks",
  "9foMHsSDq7nMg4WPusSz9eY7tyxyukqborA8GyU5cUxD": "ondo",
};
export const issuerMintPrefixes: { prefix: string; issuer: "prestocks" }[] = [{ prefix: "Pre", issuer: "prestocks" }];
export const backpackAuthority = "2cVYpagTt7ZGc3mmTXBa7fAznUtx5DUu6aCq8uVDaf4a"; // freeze, delegate, pause and hook authority on every .US mint
