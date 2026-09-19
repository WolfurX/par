import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { WalletContext } from "@/components/WalletProvider";

export const metadata: Metadata = {
  title: "Par",
  description:
    "Every on-chain way to own a company on Solana, public or pre-IPO, on one label: each issuer's own reference price, round-trip cost at your size, and what the token legally is.",
};

const FEE_BPS = Number(process.env.FEE_BPS ?? 10);

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        <WalletContext>
          <div className="page">
            <header className="site-header">
              <Link href="/" className="brand">
                Par
              </Link>
              <nav aria-label="Sections">
                <Link href="/">Companies</Link>
                <Link href="/holdings">Holdings</Link>
                <Link href="/rules">Rules</Link>
                <Link href="/fees">Fees</Link>
                <Link href="/about">About</Link>
              </nav>
            </header>
            {children}
            <footer className="site-footer">
              <p>
                Par is an information interface. It does not hold funds, execute trades, or give investment, legal or tax advice. Tokens
                shown are issued by third parties under their own terms; they are not shares and carry no shareholder rights. Swaps are
                built through the Jupiter Swap API (Metis routing) and signed in your own wallet. Par takes a fixed {FEE_BPS / 100}% fee on
                routed swaps and may earn referral shares from Tessera and Backpack, always printed on the label. Prices can move against
                you; you can lose everything you put in. Issuers exclude US persons and other jurisdictions; you are responsible for the
                laws where you live.
              </p>
              <p>
                Powered by Jupiter. Reference prices from Pyth where marked, otherwise from each issuer&apos;s own source, with the age
                printed. <Link href="/rules">How ranking works</Link> · <Link href="/fees">Fee ledger</Link> · <Link href="/about">Sources</Link>
              </p>
            </footer>
          </div>
        </WalletContext>
      </body>
    </html>
  );
}
