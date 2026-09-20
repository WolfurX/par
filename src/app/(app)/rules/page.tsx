import { holdScoreTable, legalLines } from "@/lib/legal";
import { intentNotes } from "@/lib/ranking";

const FEE_BPS = Number(process.env.FEE_BPS ?? 10);
const FEE_WALLET = process.env.FEE_WALLET ?? "";

export const metadata = { title: "Rules" };

export default function RulesPage() {
  const issuers = Object.values(legalLines);
  return (
    <main>
      <h1>How the numbers are made</h1>
      <p className="muted">Every formula on a label is here. The fee and any referral never move a row.</p>

      <h2>Units</h2>
      <p>
        Raw token units are canonical. A displayed unit is raw ÷ 10<sup>decimals</sup> × m, where m is the Token-2022 scaled amount
        multiplier in force now (the newer multiplier once its effective time has passed). Wallets show units. Aggregators and pool
        explorers usually show raw prices, which is why PreStocks OPENAI reads about 1.49× higher there than the unit price.
      </p>

      <h2>Reference and premium</h2>
      <p>
        R is the reference per share for public names (Pyth Core on-chain, then Pyth Pro when entitled, then the Backpack external tape,
        then the issuer&apos;s price data) and the issuer&apos;s own mark per unit for pre-IPO names (Tessera token details, PreStocks API).
        The source and its age are printed on every line.
      </p>
      <p className="mono small">
        buy: P<sub>raw</sub> = (S − S·f) ÷ out<sub>raw</sub>; P<sub>unit</sub> = P<sub>raw</sub> ÷ m
        <br />
        sell: P<sub>raw</sub> = (out<sub>usdc</sub> + fee<sub>usdc</sub>) ÷ in<sub>raw</sub>
        <br />
        premium = P<sub>unit</sub> ÷ R − 1, at the entered size S, size printed
        <br />
        money line = S − S ÷ (1 + premium)
      </p>

      <h2>Expected and minimum</h2>
      <p>
        Expected is the Jupiter quote cross-checked by a server-side simulation of the exact transaction at commitment processed. If the
        simulated delivery differs from the quote by more than 0.05%, the simulated figure is printed and the route is marked. Minimum is
        the on-chain threshold at the chosen slippage (50 bps on pools above 500K USD, 100 bps below), the only figure the chain enforces.
        Route legs that deliver under 0.999× the quote are excluded for that token; as of 2026-09-16 that is Manifest on PreStocks, which
        ignores the 0.5% transfer fee.
      </p>

      <h2>Fees and round trip</h2>
      <p>
        Fees in: Parsec {FEE_BPS / 100}% on the USDC input, plus the issuer&apos;s transfer fee withheld on the pool-to-wallet transfer
        (Tessera 0.2%, PreStocks 0.5%, others 0). Fees out: the same on the way back. Network: 5,000 lamports per signature; a new
        Token-2022 token account costs 1,488,440 lamports of rent. Round trip quotes the buy, then a sell of exactly the expected amount, and
        prints absolute USDC and percent.
      </p>
      <p>
        The fee is taken by the Jupiter Swap API build path into the USDC account of <span className="mono">{FEE_WALLET}</span>, the same
        basis points on every wrapper. Jupiter takes nothing on this path. The compare line shows what jup.ag&apos;s own route would deliver at
        the same size with its own 0.10% fee.
      </p>

      <h2>Market state</h2>
      <p>
        US session state comes from Pyth&apos;s published schedule for the equity feed (New York sessions with holidays), cross-checked against
        Backpack&apos;s session list. Backpack&apos;s SPCX, MU, SNDK and SKHY spot books run 24/7. Session state never disables an on-chain swap; it
        changes what the reference means.
      </p>

      <h2>Sort orders</h2>
      <table>
        <tbody>
          {Object.entries(intentNotes).map(([k, v]) => (
            <tr key={k}>
              <td style={{ width: "9em" }}>{k[0].toUpperCase() + k.slice(1)}</td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Hold score</h2>
      <table>
        <thead>
          <tr>
            <th>Rule</th>
            <th className="num">Points</th>
          </tr>
        </thead>
        <tbody>
          {holdScoreTable.map((r) => (
            <tr key={r.rule}>
              <td>{r.rule}</td>
              <td className="num">+{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table>
        <thead>
          <tr>
            <th>Issuer</th>
            <th>Form</th>
            <th className="num">Transfer fee</th>
            <th className="num">Hold score</th>
            <th className="num">Redeem tier</th>
          </tr>
        </thead>
        <tbody>
          {issuers.map((l) => (
            <tr key={l.id}>
              <td>{l.entity}</td>
              <td>{l.form}</td>
              <td className="num">{l.transferFeeBps / 100}%</td>
              <td className="num">{l.holdScore}</td>
              <td className="num">{l.redeemTier}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Referral disclosures</h2>
      <p>
        Tessera: after a T-Token buy, a wallet with no existing registration can register under Parsec&apos;s referral code as a separate,
        opt-in transaction. It costs the wallet about 0.0042 SOL of rent, gives the wallet nothing, and earns Parsec 30% of Tessera&apos;s 0.2%
        fee on that wallet&apos;s future sells and transfers, paid by Tessera in T-Tokens in batches. Wallets already registered elsewhere are
        never re-bound. Backpack: the join link on Backpack rows earns Parsec 10% of a referred account&apos;s crypto trading fees; stock trades
        there carry no commission, so it earns nothing on stock flow.
      </p>
    </main>
  );
}
