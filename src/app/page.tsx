import TickerField from "@/components/TickerField";
import { legalFor } from "@/lib/legal";
import { companyById, wrappersForCompany } from "@/lib/registry";
import "./landing.css";

const issuerName: Record<string, string> = { xstocks: "xStocks (Backed)", ondo: "Ondo", backpack: "Backpack", tessera: "Tessera", prestocks: "PreStocks" };

export default function LandingPage() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "/companies";
  const demo = companyById.get("openai")!;
  const demoWrappers = wrappersForCompany(demo.id);

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

          <section className="landing-term">
            <div className="landing-panel">
              <div className="landing-panel-title">parsec</div>
              <div className="landing-panel-body">
                <p>
                  &gt; <span className="landing-type">openai 1000</span>
                </p>
                <div className="landing-frame">
                  <p>{`${demo.name}  ${demo.kind}`}</p>
                  {demoWrappers.map((w) => (
                    <p key={w.symbol}>{`${w.symbol}  ${issuerName[w.issuer]}  ${legalFor(w.issuer, w.legalId).form}`}</p>
                  ))}
                </div>
                <p className="landing-frame-end">prices load in the app</p>
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
