"use client";

import Link from "next/link";
import { Fragment, use, useEffect, useState } from "react";
import { INTENTS, intentNotes, type Intent } from "@/lib/ranking";
import { fmtAge, fmtPct, fmtUsd } from "@/lib/units";

interface Row {
  rank: number;
  mint: string;
  symbol: string;
  issuer: string;
  name: string;
  unitPrice: number | null;
  multiplier: number;
  reference: { price: number; source: string; ageSec: number; pythMark?: boolean; stale: boolean } | null;
  premium: number | null;
  premiumUsd: number | null;
  liquidityUsd: number;
  volume24hUsd: number;
  noLiquidity: boolean;
  thin: boolean;
  belowMark: boolean;
  own: string;
  holdScore: number;
  redeemTier: number;
}
interface Payload {
  company: { id: string; name: string; ticker?: string; kind: "public" | "private" };
  intent: Intent;
  size: number;
  feeBps: number;
  market: { session: string; isOpen: boolean; text: string } | null;
  index: { price: number; asOf: number; label: string } | null;
  rows: Row[];
  generatedAt: number;
}

const issuerName: Record<string, string> = { xstocks: "xStocks (Backed)", ondo: "Ondo", backpack: "Backpack", tessera: "Tessera", prestocks: "PreStocks" };

export default function CompanyPage({ params }: { params: Promise<{ company: string }> }) {
  const { company } = use(params);
  const [intent, setIntent] = useState<Intent>("hold");
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setErr(null);
    fetch(`/api/company/${company}?intent=${intent}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        return r.json();
      })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [company, intent]);

  if (err) return <main><p className="warn">{err}</p></main>;
  if (!data) return <main><p className="muted">Loading references, pools and mids.</p></main>;

  const c = data.company;
  const refs = data.rows.filter((r) => r.reference).map((r) => r.reference!);
  const uniqueRefs = Array.from(new Map(refs.map((r) => [r.source, r])).values());
  const priced = data.rows.filter((r) => r.unitPrice != null);

  return (
    <main>
      <h1>
        {c.name} {c.ticker ? <span className="mono muted">{c.ticker}</span> : null}
      </h1>
      <p className="small muted">
        {c.kind === "public" ? "Listed company." : "Private company. Each issuer publishes its own mark; there is no exchange price."}{" "}
        {data.market ? <span>US market: {data.market.text}.</span> : null}
      </p>
      {priced.length >= 2 ? (
        <p>
          <b className="mono">
            {fmtUsd(Math.min(...priced.map((r) => r.unitPrice!)))} to {fmtUsd(Math.max(...priced.map((r) => r.unitPrice!)))} USD across{" "}
            {new Set(priced.map((r) => r.issuer)).size} issuers.
          </b>{" "}
          <span className="muted">Compare {data.rows.length} wrappers below.</span>
        </p>
      ) : null}
      <dl className="label">
        {uniqueRefs.map((r) => (
          <Fragment key={r.source}>
            <dt>Reference</dt>
            <dd>
              {fmtUsd(r.price)} USD <span className="detail">{r.source}, {fmtAge(r.ageSec)}{r.stale ? ", served from cache" : ""}{r.pythMark ? <span className="pyth-mark">PYTH</span> : null}</span>
            </dd>
          </Fragment>
        ))}
        {data.index ? (
          <>
            <dt>Index</dt>
            <dd>
              {fmtUsd(data.index.price)} USD <span className="detail">{data.index.label}<span className="pyth-mark">PYTH</span></span>
            </dd>
          </>
        ) : null}
      </dl>

      <div className="controls">
        <div className="seg" role="group" aria-label="Intent">
          {INTENTS.map((it) => (
            <button key={it.id} aria-pressed={intent === it.id} onClick={() => setIntent(it.id)}>
              {it.label}
            </button>
          ))}
        </div>
        <span className="small muted">Premium at mid, fee {data.feeBps / 100}% printed on the label. Sized quotes on each row&apos;s label.</span>
      </div>
      <p className="small muted">{intentNotes[intent]}</p>

      <div className="row-list">
        {data.rows.map((r) => (
          <div className="row" key={r.mint}>
            <div className="rank">{r.rank}</div>
            <div>
              <div className="head">
                <Link href={`/c/${c.id}/${encodeURIComponent(r.symbol)}`} className="sym">
                  {r.symbol}
                </Link>
                <span className="issuer">{issuerName[r.issuer] ?? r.issuer}</span>
                {r.noLiquidity ? <span className="issuer">no on-chain liquidity</span> : null}
                {r.thin && !r.noLiquidity ? <span className="issuer">thin</span> : null}
              </div>
              <div className="nums">
                <span>{r.unitPrice != null ? `${fmtUsd(r.unitPrice)} USD per unit` : "no mid"}</span>
                <span>{r.premium != null ? `${fmtPct(r.premium)} to reference` : "no reference"}</span>
                <span>liq {fmtUsd(r.liquidityUsd, 0)}</span>
                <span>24h {fmtUsd(r.volume24hUsd, 0)}</span>
                {intent === "hold" ? <span>hold score {r.holdScore}</span> : null}
                {intent === "redeemable" ? <span>tier {r.redeemTier}</span> : null}
              </div>
              {r.belowMark ? (
                <div className="small warn">Below mark: no enforceable redemption at the mark; the discount is not a payout.</div>
              ) : null}
              <div className="own">{r.own}</div>
            </div>
            <div className="act">
              <div>
                <Link href={`/c/${c.id}/${encodeURIComponent(r.symbol)}`}>Compare</Link>
              </div>
              {r.reference ? <div className="muted small">{fmtAge(r.reference.ageSec)}</div> : null}
            </div>
          </div>
        ))}
      </div>
      <p className="small muted">Generated {fmtAge(Math.floor(Date.now() / 1000) - data.generatedAt)}. Rows never move for fees or referrals; see <Link href="/rules">rules</Link>.</p>
    </main>
  );
}
