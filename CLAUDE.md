# Parsec

Tokenized-stock label for Solana wallets. Every on-chain way to own a company, public or pre-IPO, on one label: each issuer's own reference price, round-trip cost at the user's size with our fee printed, and what the token legally is, before the user signs in their own wallet. No AI. The user decides. Built for the Stocklana hackathon (submissions close 2026-09-25 20:00 UTC).

## Stack

Next.js 16 App Router, TypeScript, Node runtime, Vercel. `@solana/web3.js` v1, `@solana/spl-token` 0.4.15, wallet-adapter react/base/react-ui with `wallets={[]}` (Wallet Standard discovery), `@coral-xyz/anchor` for the Tessera IDL only. Plain CSS in `src/app/globals.css`; no Tailwind, no component library.

## Rules that every module follows

- Raw token units are canonical. Displayed units = raw / 10^decimals x m, where m = `newMultiplier` once `now >= newMultiplierEffectiveTimestamp`, else `multiplier`. RPC `jsonParsed` uiAmount already applies m; Helius DAS balances, Jupiter amounts and DexScreener prices are raw. Never display DAS `price_info.total_price`.
- Every number shown carries its source, and its age where the source gives one (never the age of our own fetch passed off as the price's). References are cached server-side; three upstream failures in a row skip that source for 60 s, and only when every source fails is the freshest last good value served, marked as from cache.
- Keys live in server-only env (`HELIUS_API_KEY`, `JUPITER_API_KEY`, `PYTH_PRO_API_KEY`). Nothing secret is `NEXT_PUBLIC_`. Clients call our `/api/*` routes, never upstream APIs.
- Swaps go through Jupiter Swap V2 `GET https://api.jup.ag/swap/v2/build` with `platformFeeBps=FEE_BPS` and `feeAccount` = the fee wallet's USDC token account (input side on buys, output side on sells). Never `/order` for building. Header `x-api-key` when `JUPITER_API_KEY` is set. Budget Jupiter as 100 requests per 10 s org-wide; the company page quotes every wrapper at size through `/order`, plus a 10 USDC `/order` quote per wrapper as the impact mid, quote only and cached 120 s per mint and size; the buy screen simulates the selected one.
- Every built transaction is simulated server-side at commitment `processed` before it is returned. "Expected" is the quote cross-checked by simulation; "Minimum" is `otherAmountThreshold`. Route legs that deliver under 0.9975x the quote, or revert twice a minute or more apart, are excluded for that mint for an hour (Manifest ignores the PreStocks transfer fee: it short-paid on 2026-09-16 and reverts as of 2026-09-23).
- `/build` returns only the compute-unit price instruction: simulate at 1.4M CU, then set the limit to 1.2x units used.
- The fee and any referral never move a ranking row. Ranking formulas are published on `/rules`.
- Copy: plain sentences, no adjectives, no "buy", "best", "recommended", "should", "cheap", "opportunity", "invest", "own Apple", "guaranteed", "safe". Use "exposure", "token tracking", "premium to reference", "redeemable via [route] after KYC". No em dashes anywhere.
- UI: one column, native hairlines, no cards, no callout boxes, no badges, no issuer logos, tabular numerals, 390 px pass.
- Wallet sanctions screening runs server-side before `/api/build` returns a transaction (Jupiter API licence s.7.3). The label prints "Routing: Metis (Jupiter Swap API)"; the footer prints "Powered by Jupiter". Pyth-sourced numbers carry a small monochrome "Pyth" text mark.
- Price history is cached 5 minutes per mint and range; GeckoTerminal calls are serialised 2.2 s apart (its public tier throttles near 30 a minute and CDN-caches 30 to 60 s), fall back to Jupiter datapi on a 429, and never touch its `tokens/<mint>/pools` endpoint. GeckoTerminal closes are per raw token, datapi closes are per displayed unit.

## Layout

- `src/lib/types.ts` shared types (read before writing any module).
- `src/lib/registry.ts` companies and wrappers pinned by mint address. Same-symbol fakes exist; never resolve by symbol.
- `src/lib/legal.ts` per-issuer "what you own" lines, powers, exclusions, fees, source links.
- `src/lib/units.ts` multiplier and unit math.
- `src/lib/rpc.ts` Helius connection, mint state reader.
- `src/lib/reference.ts` reference ladder per wrapper (Pyth Core on-chain, Pyth Pro, Backpack external, issuer APIs).
- `src/lib/sessions.ts` US market session state from Pyth's keyless symbol schedule.
- `src/lib/pools.ts` DexScreener depth and volume.
- `src/lib/history.ts` price candles for the label chart: GeckoTerminal OHLCV on the top DexScreener pool, Jupiter datapi fallback.
- `src/app/api/history/[mint]` candles plus the reference level for the chart.
- `src/lib/jupiter.ts` quotes, build, simulation, expected and minimum, delivery ratios, jup.ag comparison.
- `src/lib/holdings.ts` wallet positions from Helius DAS with powers and events.
- `src/lib/tessera.ts` referral PDAs, registration builder from the pinned IDL in `src/lib/idl/tessera_referrals.json`.
- `src/lib/screening.ts` sanctions address screening.
- `src/app/api/*` route handlers; `src/app/c/[company]`, `src/app/c/[company]/[wrapper]`, `src/app/portfolio`, `src/app/rules`, `src/app/fees`, `src/app/about`.
- `scripts/*.mjs` verification scripts that hit live APIs and mainnet simulation; each module ships one.

## Verification

`npm run typecheck` (tsc --noEmit) and `npm run build` must pass. Each module's script under `scripts/` prints the values a human can check against the source (issuer API, explorer, Jupiter). Nothing is broadcast to mainnet by scripts; simulations only.
