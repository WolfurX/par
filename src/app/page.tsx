import TickerField from "@/components/TickerField";
import "./landing.css";

export default function LandingPage() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "/companies";

  return (
    <div className="landing">
      <TickerField />
      <div className="landing-shell">
        <header className="landing-header">
          <span className="landing-wordmark">Parsec</span>
          <a className="landing-launch" href={appUrl}>Launch App</a>
        </header>

        <main>
          <section className="landing-hero">
            <div className="landing-wrap">
              <div className="landing-hero-in">
                <p className="landing-eyebrow">Parallax</p>
                <h1>A company&apos;s tokens on Solana, side by side at your size.</h1>
                <p className="landing-sub">Same stock, different prices. Compare them before you sign.</p>
              </div>
            </div>
          </section>

          <section className="landing-how">
            <div className="landing-wrap">
              <p className="landing-kicker">How it works</p>
              <div className="landing-steps">
                <div className="landing-step">Find every wrapper of a company.</div>
                <div className="landing-step">Compare them at your size.</div>
                <div className="landing-step">Sign in your own wallet.</div>
              </div>
            </div>
          </section>

          <section className="landing-how">
            <div className="landing-wrap">
              <p className="landing-kicker">What it shows</p>
              <div className="landing-steps">
                <div className="landing-step">Pre-IPO tokens against their issuer&apos;s own mark, including Tessera&apos;s tOpenAI, tKalshi and tSpaceX.</div>
                <div className="landing-step">The round trip at your size, with every fee on its own line.</div>
                <div className="landing-step">What each token legally is, and who can freeze or move it.</div>
                <div className="landing-step">Every token pinned by mint address, so look-alikes stay out.</div>
              </div>
            </div>
          </section>

          <section className="landing-issuers">
            <div className="landing-wrap">
              <p className="landing-kicker">Issuers</p>
              <p>xStocks, Ondo, Backpack, Tessera, PreStocks.</p>
            </div>
          </section>
        </main>

        <footer className="landing-footer">
          <div className="landing-wrap">
            <p>Parsec is an information interface. It holds no funds and gives no advice.</p>
            <p>Swaps are built through Jupiter and signed in your own wallet; Parsec takes a fixed 0.1% fee, printed on every label.</p>
            <p className="landing-pow">Powered by Jupiter</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
