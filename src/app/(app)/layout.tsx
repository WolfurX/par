import Link from "next/link";
import { WalletContext } from "@/components/WalletProvider";
import WalletButton from "./WalletButton";

const FEE_BPS = Number(process.env.FEE_BPS ?? 10);

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WalletContext>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        rel="stylesheet"
        precedence="default"
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
      />
      <header className="titlebar">
        <div className="titlebar-in">
          <Link href="/companies" className="wordmark">
            Parsec
          </Link>
          <nav aria-label="Sections">
            <Link href="/companies">Companies</Link>
            <Link href="/holdings">Holdings</Link>
          </nav>
          <WalletButton />
        </div>
      </header>
      <div className="page">
        {children}
        <footer className="site-footer">
          <p>
            Parsec is an information interface. It does not hold funds, execute trades, or give investment, legal or tax advice. Tokens
            shown are issued by third parties under their own terms; they are not shares and carry no shareholder rights. Swaps are
            built through the Jupiter Swap API (Metis routing) and signed in your own wallet. Parsec takes a fixed {FEE_BPS / 100}% fee on
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
  );
}
