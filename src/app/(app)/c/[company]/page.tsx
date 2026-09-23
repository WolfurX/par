"use client";

import Link from "next/link";
import { Fragment, use, useEffect, useRef, useState } from "react";
import { INTENTS, type Intent } from "@/lib/ranking";
import { fmtAge, fmtPct, fmtUsd } from "@/lib/units";
import type { Candle } from "@/lib/history";
import Sparkline from "@/components/Sparkline";

interface Row {
  mint: string;
  symbol: string;
  issuer: string;
  reference: { price: number; source: string; ageSec: number | null; pythMark?: boolean; stale: boolean } | null;
  unitPrice: number | null;
  premium: number | null;
  premiumUsd: number | null;
  impact: number | null;
  roundTripUsdc: number | null;
  roundTripPct: number | null;
  feesInBps: number;
  feesOutBps: number;
  routeLabels: string[];
  quotedAt: number | null;
  liquidityUsd: number;
  volume24hUsd: number;
  belowMark: boolean;
  form: string;
  redemption: string;
}
interface Payload {
  company: { id: string; name: string; ticker?: string; kind: "public" | "private" };
  sort: Intent;
  size: number;
  feeBps: number;
  market: { session: string; isOpen: boolean; text: string } | null;
  index: { price: number; asOf: number; label: string } | null;
  rows: Row[];
  generatedAt: number;
  quoted: boolean;
}

const issuerName: Record<string, string> = { xstocks: "xStocks (Backed)", ondo: "Ondo", backpack: "Backpack", tessera: "Tessera", prestocks: "PreStocks" };
const noRoute = <span className="muted">no route at this size</span>;
const quoting = <span className="muted">quoting</span>;

export default function CompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ company: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { company } = use(params);
  const sp = use(searchParams);
  const [sort, setSort] = useState<Intent>(() => (INTENTS.some((i) => i.id === sp.sort) ? (sp.sort as Intent) : "price"));
  const [size, setSize] = useState(() => Math.min(1_000_000, Math.max(1, Number(sp.size) || 1000)));
  const [sizeInput, setSizeInput] = useState(() => String(size));
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [spark, setSpark] = useState<Record<string, number[]>>({});
  const tbl = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    let alive = true;
    setErr(null);
    fetch(`/api/company/${company}?sort=${sort}&size=${size}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        // A frame only replaces an empty page or another unquoted frame, and once quoted rows are on screen
        // only the quoted line replaces them, so columns move once. A size or sort change keeps the previous
        // quoted columns until its own quoted line arrives, as today.
        const lines = r.body!.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        let quoted = false;
        for (;;) {
          const { value, done } = await lines.read();
          if (!alive) return;
          if (done) {
            if (quoted) return;
            throw new Error("Quotes did not arrive. Reload to try again.");
          }
          buf += value;
          for (let n = buf.indexOf("\n"); n >= 0; n = buf.indexOf("\n")) {
            const d: Payload = JSON.parse(buf.slice(0, n));
            buf = buf.slice(n + 1);
            quoted ||= d.quoted;
            setData((prev) => (d.quoted || !prev || !prev.quoted ? d : prev));
          }
        }
      })
      .catch((e) => alive && setErr(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [company, sort, size]);

  const mintList = data ? data.rows.map((r) => r.mint).sort().join(",") : "";
  useEffect(() => {
    if (!mintList) return;
    let alive = true;
    for (const mint of mintList.split(",")) {
      fetch(`/api/history/${mint}?range=7d`)
        .then((r) => (r.ok ? r.json() : null))
        .then((h: { candles: Candle[] } | null) => (h ? h.candles.map((k) => k.c) : []))
        .catch(() => [] as number[])
        .then((closes) => alive && setSpark((s) => ({ ...s, [mint]: closes })));
    }
    return () => {
      alive = false;
    };
  }, [mintList]);

  function cue() {
    const el = tbl.current;
    if (el) setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }
  useEffect(() => {
    const el = tbl.current;
    if (!el) return;
    const ro = new ResizeObserver(cue);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [data]);

  function updateSort(next: Intent) {
    setSort(next);
    window.history.replaceState(null, "", `?sort=${next}&size=${size}`);
  }

  function commitSize(raw: string) {
    const next = Math.min(1_000_000, Math.max(1, Number(raw) || 1000));
    setSize(next);
    setSizeInput(String(next));
    window.history.replaceState(null, "", `?sort=${sort}&size=${next}`);
  }

  if (err) return <main><p className="warn">{err}</p></main>;
  if (!data) return <main><p className="muted">Loading references and pools.</p></main>;

  const c = data.company;
  const refs = data.rows.filter((r) => r.reference).map((r) => r.reference!);
  const uniqueRefs = Array.from(new Map(refs.map((r) => [r.source, r])).values());
  const priced = data.rows.filter((r) => r.unitPrice != null);
  const now = Math.floor(Date.now() / 1000);

  const matrixRows: { k: string; cell: (r: Row, i: number) => React.ReactNode }[] = [
    {
      k: "Wrapper",
      cell: (r) => (
        <>
          <Link href={`/c/${c.id}/${encodeURIComponent(r.symbol)}?size=${size}`} className="sym">
            {r.symbol}
          </Link>
          <span className="detail">{issuerName[r.issuer] ?? r.issuer}</span>
        </>
      ),
    },
    {
      k: "Price at size",
      cell: (r, i) =>
        !data.quoted ? quoting : (
          <span className="fade" key={r.quotedAt ?? 0}>
            {r.unitPrice == null ? (
              noRoute
            ) : (
              <>
                <span className={i === 0 ? "win" : undefined}>{fmtUsd(r.unitPrice)} USD</span>
                <span className="detail">
                  route {r.routeLabels.join(" + ") || "none"}
                  {r.quotedAt != null ? `, ${fmtAge(now - r.quotedAt)}` : ""}
                </span>
              </>
            )}
          </span>
        ),
    },
    {
      k: "7 days",
      cell: (r) => {
        const closes = spark[r.mint];
        if (!closes) return <span className="spark-wait" />;
        return closes.length === 0 ? <span className="muted spark-none">no history</span> : <Sparkline closes={closes} />;
      },
    },
    {
      k: "Premium",
      cell: (r) =>
        !data.quoted ? quoting : (
          <span className="fade" key={r.quotedAt ?? 0}>
            {r.unitPrice == null ? (
              noRoute
            ) : r.premium == null ? (
              data.market?.session === "closed" && r.issuer !== "tessera" && r.issuer !== "prestocks" ? (
                "No reference while the US market is closed"
              ) : (
                "no reference"
              )
            ) : (
              <>
                {fmtPct(r.premium)}
                <span className="detail">{fmtUsd(Math.abs(r.premiumUsd ?? 0), 0)} USD at this size</span>
                {r.belowMark ? <span className="detail warn">below mark, not a payout</span> : null}
              </>
            )}
          </span>
        ),
    },
    {
      k: "Impact",
      cell: (r) =>
        !data.quoted ? quoting : (
          <span className="fade" key={r.quotedAt ?? 0}>
            {r.unitPrice == null ? noRoute : r.impact == null ? <span className="muted">n/a</span> : `${(r.impact * 100).toFixed(2)}%`}
          </span>
        ),
    },
    {
      k: "Round trip",
      cell: (r) =>
        !data.quoted ? quoting : (
          <span className="fade" key={r.quotedAt ?? 0}>
            {r.unitPrice == null || r.roundTripPct == null ? (
              noRoute
            ) : (
              <>
                {fmtPct(r.roundTripPct, 1)}
                <span className="detail">{fmtUsd(data.size + (r.roundTripUsdc ?? 0), 0)} USDC back</span>
              </>
            )}
          </span>
        ),
    },
    {
      k: "Fees in",
      cell: (r) => (
        <>
          {r.feesInBps / 100}%
          <span className="detail">
            Parsec {data.feeBps / 100}% + issuer {(r.feesInBps - data.feeBps) / 100}%
          </span>
        </>
      ),
    },
    {
      k: "Fees out",
      cell: (r) => (
        <>
          {r.feesOutBps / 100}%
          <span className="detail">
            Parsec {data.feeBps / 100}% + issuer {(r.feesOutBps - data.feeBps) / 100}%
          </span>
        </>
      ),
    },
    {
      k: "What it is",
      cell: (r) => (
        <>
          <span className="text">{r.form}</span>
          <Link href={`/c/${c.id}/${encodeURIComponent(r.symbol)}?size=${size}`} className="detail">
            Read terms
          </Link>
        </>
      ),
    },
    {
      k: "Exit",
      cell: (r) => <span className="text">{r.redemption}</span>,
    },
    {
      k: "Liquidity",
      cell: (r) => (
        <>
          {fmtUsd(r.liquidityUsd, 0)} USD
          <span className="detail">24h {fmtUsd(r.volume24hUsd, 0)} USD</span>
        </>
      ),
    },
    {
      k: "",
      cell: (r) => (
        <Link className="btn" href={`/c/${c.id}/${encodeURIComponent(r.symbol)}?size=${size}`}>
          Buy {r.symbol}
        </Link>
      ),
    },
  ];

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
      ) : !data.quoted && data.rows.length >= 2 ? (
        <p className="muted">Quoting {data.rows.length} wrappers at {fmtUsd(data.size, 0)} USDC.</p>
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

      <div className="strip">
        <label className="small muted" htmlFor="size">Size, USDC</label>
        <input id="size" inputMode="decimal" value={sizeInput} onChange={(e) => setSizeInput(e.target.value)} onBlur={() => commitSize(sizeInput)} style={{ width: "9em" }} />
        <span className="small muted">Sort by</span>
        <div className="seg" role="group" aria-label="Sort by">
          {INTENTS.map((it) => (
            <button key={it.id} aria-pressed={sort === it.id} onClick={() => updateSort(it.id)}>
              {it.label}
            </button>
          ))}
        </div>
      </div>
      <p className="small muted">{INTENTS.find((i) => i.id === sort)?.line}</p>

      <div className={more ? "tbl more" : "tbl"} ref={tbl} onScroll={cue}>
        <table className="matrix">
          <tbody>
            {matrixRows.map((row) => (
              <tr key={row.k || "buy"}>
                <th scope="row" className="rowlab">{row.k}</th>
                {data.rows.map((r, i) => (
                  <td key={r.mint}>{row.cell(r, i)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">Generated {fmtAge(Math.floor(Date.now() / 1000) - data.generatedAt)}. Rows never move for fees or referrals; see <Link href="/rules">rules</Link>.</p>
    </main>
  );
}
