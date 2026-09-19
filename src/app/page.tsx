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
                <h1>Every on-chain way to own a company, on one label.</h1>
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
