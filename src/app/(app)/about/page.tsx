import { legalLines } from "@/lib/legal";

export const metadata = { title: "About" };

export default function AboutPage() {
  return (
    <main>
      <h1>What Parsec is</h1>
      <p>
        Every on-chain way to own a company on Solana, public or pre-IPO, on one label: each issuer&apos;s own reference price, the full
        round-trip cost at your size with Parsec&apos;s fee printed, and a plain statement of what the token legally is, before you sign in your
        own wallet. Nothing here is a recommendation. Parsec shows facts; you decide.
      </p>

      <h2>What it is not</h2>
      <p>
        Parsec does not hold funds, does not execute trades, and does not give investment, legal or tax advice. Every swap is built through
        the Jupiter Swap API and signed in your wallet; Parsec sees the transaction, never your keys. The tokens are issued by third parties
        under their own terms. They are not shares. Issuers exclude US persons and other jurisdictions and can freeze, pause or, for some
        wrappers, move your balance; the label says which.
      </p>

      <h2>Sources</h2>
      <p>
        Reference prices: Pyth Core on-chain price accounts (keyless, updated by Pyth publishers), Pyth Pro feeds for wrapper prices and
        redemption rates where entitled, Backpack&apos;s external consolidated tape, and the issuers&apos; own APIs (Tessera, PreStocks, Backed).
        Pool depth and volume: DexScreener. Quotes and routing: Jupiter Swap API. Wallet state: Helius. Mint powers are read live from the
        token program.
      </p>

      <h2>Issuer documents</h2>
      <table>
        <thead>
          <tr>
            <th>Issuer</th>
            <th>Documents read</th>
          </tr>
        </thead>
        <tbody>
          {Object.values(legalLines).map((l) => (
            <tr key={l.id}>
              <td>{l.entity}</td>
              <td>
                {l.sources.map((s, i) => (
                  <span key={s.url}>
                    {i > 0 ? " · " : ""}
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>{" "}
                    <span className="muted small">({s.date})</span>
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Money</h2>
      <p>
        Parsec takes a fixed fee on routed swaps, printed on every label, identical on every wrapper, and collected in USDC through the
        Jupiter build path. Parsec may earn a referral share from Tessera for wallets that opt in after a T-Token buy, and from Backpack for
        accounts opened through its join link. Neither moves a ranking row. The <a href="/fees">fee ledger</a> shows what has been
        collected, on-chain.
      </p>

      <h2>Built for Stocklana</h2>
      <p>
        Parsec was built during the Stocklana hackathon (Solana Foundation, September 2026). Third-party components: Jupiter Swap API, Pyth
        price feeds, Helius RPC and DAS, DexScreener, the Tessera referral program (on-chain IDL), and the public APIs of Backed, Ondo,
        Backpack, Tessera and PreStocks.
      </p>
    </main>
  );
}
