# Parsec

Every on-chain way to own a company on Solana, public or pre-IPO, on one label: each issuer's own reference price, the round-trip cost at your size with the fee printed, and what the token legally is, before you sign in your own wallet. No AI. The user decides.

Built for the Stocklana hackathon (Solana Foundation, September 2026).

## What it does

- Company page: every wrapper of a company (xStocks, Ondo, Backpack .US, Tessera, PreStocks) side by side at your size, sorted by Price, Liquidity, Redeemable or Terms, each with a one-line "what you own".
- Buy screen: at your size, the reference price and its source, pool price, premium in percent and in dollars, US session state, price impact, expected and minimum receive (the quote checked by a server-side simulation), fees in and out, round trip, what jup.ag would deliver, then a Jupiter Swap API transaction you sign in your wallet.
- Portfolio: connect or paste a wallet; every wrapper position explained from live mint state (balance as the wallet shows it, issuer powers, transfer fee, next dated event), with a sell-now vs mark-value panel for pre-IPO tokens.
- Rules, fee ledger and sources are public pages.

## Money, stated plainly

A fixed fee (default 10 bps) on routed swaps, taken by the Jupiter Swap API build path into the fee wallet's USDC account, identical on every wrapper and printed on every label. An optional Tessera referral registration after a T-Token buy (30% of Tessera's 0.2% transfer fee on that wallet's future sells, paid by Tessera in T-Tokens). Backpack join links earn 10% of crypto trading fees, nothing on stock trades. None of it moves a ranking row.

## Run

```
cp .env.example .env.local   # HELIUS_API_KEY required; JUPITER_API_KEY and PYTH_PRO_API_KEY optional
npm install
npm run dev
```

Verification scripts under `scripts/` hit live APIs and mainnet simulation; nothing is broadcast. `npm run typecheck` and `npm run build` must pass.

## Third-party components

Jupiter Swap API (Metis routing; "Powered by Jupiter"), Pyth price feeds (Core on-chain accounts and Pro feeds), Helius RPC and DAS, DexScreener, the Tessera referral program (on-chain IDL pinned in `src/lib/idl`), and the public APIs of Backed (xStocks), Ondo, Backpack, Tessera and PreStocks. Issuer documents are linked from the About page.

## Not advice

Parsec is an information interface. It does not hold funds, execute trades, or give investment, legal or tax advice. Tokens shown are issued by third parties under their own terms; they are not shares. Issuers exclude US persons and other jurisdictions.
