"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { companyById, wrappersForCompany } from "@/lib/registry";
import { fmtAge, fmtPct, fmtUnits, fmtUsd } from "@/lib/units";
import type { Candle, HistoryRange } from "@/lib/history";
import PriceChart from "@/components/PriceChart";

type Side = "buy" | "sell";

interface LabelPayload {
  wrapper: { mint: string; symbol: string; issuer: string; name: string; decimals: number };
  company: { id: string; name: string; kind: "public" | "private" };
  legal: { line: string; transferFeeBps: number; redemption: string; sources: { title: string; url: string; date: string }[] };
  state: { multiplier: number; transferFeeBps: number; paused: boolean; permanentDelegate?: string; freezeAuthority?: string } | null;
  pool: { liquidityUsd: number; volume24hUsd: number; topPool?: { dexId: string; quoteSymbol: string } } | null;
  reference: { price: number; source: string; sourceUrl?: string; ageSec: number | null; stale: boolean; pythMark?: boolean } | null;
  market: { text: string; isOpen: boolean; session: string } | null;
  pyth: { wrapperFeed: { price: number; asOf: number } | null; redemptionRate: { price: number; asOf: number } | null; index: { price: number; asOf: number } | null };
  size: number;
  feeBps: number;
  buy: { expectedRaw: string; minimumRaw: string; slippageBps: number; routeLabels: string[]; deliveryRatio?: number; quotedAt: number; simulatedOutRaw?: string } | null;
  quoteError: string | null;
  row: {
    unitPrice: number | null; rawPrice: number | null; multiplier: number; premium: number | null; premiumUsd: number | null; impact: number | null;
    expectedUnits: number | null; minimumUnits: number | null; feesInBps: number; feesOutBps: number; roundTripUsdc: number | null; roundTripPct: number | null;
    thin: boolean; noLiquidity: boolean; belowMark: boolean; routeLabels: string[]; deliveryRatio: number | null;
    compare: { jupOutUnits: number | null; jupFeeBps: number | null; deltaUnits: number | null };
  };
  usdcMint: string;
  generatedAt: number;
}

interface Receipt { signature: string; receivedRaw?: string; expectedRaw: string; minimumRaw: string; feeRaw?: string; feeAccount?: string }

interface HistoryPayload {
  symbol: string;
  candles: Candle[];
  reference: { price: number; source: string; ageSec: number | null } | null;
  pool: { pairAddress: string; dexId: string } | null;
  source: string | null;
  fetchedAt: number;
}

const issuerName: Record<string, string> = { xstocks: "xStocks (Backed)", ondo: "Ondo", backpack: "Backpack", tessera: "Tessera", prestocks: "PreStocks" };

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export default function LabelPage({
  params,
  searchParams,
}: {
  params: Promise<{ company: string; wrapper: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { company, wrapper } = use(params);
  const sp = use(searchParams);
  const initialSize = Math.min(1_000_000, Math.max(1, Number(sp.size) || 1000));
  const c = companyById.get(company);
  const w = useMemo(() => wrappersForCompany(company).find((x) => x.symbol === decodeURIComponent(wrapper)), [company, wrapper]);
  const { publicKey, signTransaction, connected } = useWallet();
  const [size, setSize] = useState(initialSize);
  const [sizeInput, setSizeInput] = useState(String(initialSize));
  const [side, setSide] = useState<Side>("buy");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [data, setData] = useState<LabelPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [tessera, setTessera] = useState<{ registered: boolean; guard: { ok: boolean; reason?: string }; code: string; rentLamports: number } | null>(null);
  const [hrange, setHrange] = useState<HistoryRange>("7d");
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(() => {
    if (!w) return;
    setLoading(true);
    setErr(null);
    const taker = publicKey ? `&taker=${publicKey.toBase58()}` : "";
    fetch(`/api/label?mint=${w.mint}&size=${size}${taker}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        return r.json();
      })
      .then(setData)
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [w, size, publicKey]);

  useEffect(() => {
    load();
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      if (!document.hidden) load();
    }, 30_000);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [load]);

  useEffect(() => {
    if (!publicKey || !w || w.issuer !== "tessera") { setTessera(null); return; }
    fetch(`/api/tessera?user=${publicKey.toBase58()}`).then((r) => r.ok ? r.json() : null).then(setTessera).catch(() => setTessera(null));
  }, [publicKey, w]);

  useEffect(() => {
    if (!w) return;
    let cancelled = false;
    fetch(`/api/history/${w.mint}?range=${hrange}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((h) => { if (!cancelled && h) setHistory(h); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [w, hrange]);

  useEffect(() => {
    setDetailsOpen(window.matchMedia("(min-width: 641px)").matches);
  }, []);

  if (!c || !w) return <main><p className="warn">Unknown wrapper.</p></main>;

  async function buildAndSign() {
    if (!data || !publicKey || !signTransaction) return;
    setStatus("Building the transaction and simulating it.");
    setReceipt(null);
    try {
      const amountRaw = side === "buy" ? String(Math.round(size * 1e6)) : data.buy?.expectedRaw ?? "0";
      const res = await fetch("/api/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mint: w!.mint, side, amountRaw, taker: publicKey.toBase58(), slippageBps: data.buy?.slippageBps ?? 100 }),
      });
      const built = await res.json();
      if (!res.ok) throw new Error(built.error ?? res.statusText);
      setStatus(`Expected ${fmtUnits(Number(built.expectedRaw) / 10 ** w!.decimals * (data.row.multiplier || 1))}, minimum ${fmtUnits(Number(built.minimumRaw) / 10 ** w!.decimals * (data.row.multiplier || 1))}. Sign in your wallet.`);
      const tx = VersionedTransaction.deserialize(b64ToBytes(built.transactionBase64));
      const signed = await signTransaction(tx);
      setStatus("Sending and waiting for confirmation.");
      const sent = await fetch("/api/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedTransactionBase64: bytesToB64(signed.serialize()), blockhash: built.blockhash, lastValidBlockHeight: built.lastValidBlockHeight, taker: publicKey.toBase58(), mint: w!.mint }),
      });
      const r = await sent.json();
      if (!sent.ok) throw new Error(r.error ?? sent.statusText);
      setReceipt({ signature: r.signature, receivedRaw: r.receivedRaw, expectedRaw: built.expectedRaw, minimumRaw: built.minimumRaw, feeRaw: r.feeRaw, feeAccount: r.feeAccount });
      setStatus(null);
      load();
    } catch (e) {
      setStatus(null);
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function registerTessera() {
    if (!publicKey || !signTransaction) return;
    try {
      setStatus("Building the registration.");
      const res = await fetch("/api/tessera", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: publicKey.toBase58() }) });
      const built = await res.json();
      if (!res.ok) throw new Error(built.error ?? res.statusText);
      const tx = VersionedTransaction.deserialize(b64ToBytes(built.transactionBase64));
      const signed = await signTransaction(tx);
      const sent = await fetch("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedTransactionBase64: bytesToB64(signed.serialize()), blockhash: built.blockhash, lastValidBlockHeight: built.lastValidBlockHeight }) });
      const r = await sent.json();
      if (!sent.ok) throw new Error(r.error ?? sent.statusText);
      setStatus(`Registered. Signature ${r.signature.slice(0, 12)}…`);
      setTessera((t) => (t ? { ...t, registered: true } : t));
    } catch (e) {
      setStatus(null);
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const m = data?.row.multiplier ?? 1;
  const units = (raw: string | undefined) => (raw ? fmtUnits((Number(raw) / 10 ** w.decimals) * m) : "");

  const dash = <span className="muted">-</span>;
  const quoteAge = data ? Math.floor(Date.now() / 1000) - (data.buy?.quotedAt ?? data.generatedAt) : 0;
  const noRef =
    data && !data.reference && data.market?.session === "closed" && w.issuer !== "tessera" && w.issuer !== "prestocks"
      ? "No reference while the US market is closed"
      : null;
  const noPool = data?.row.noLiquidity === true;

  const line1: React.ReactNode = !data ? (
    <>For {fmtUsd(size, 0)} USDC you get {dash} {w.symbol}</>
  ) : noPool ? (
    <>No on-chain pool for {w.symbol}</>
  ) : side === "buy" ? (
    <>
      For {fmtUsd(data.size, 0)} USDC you get {data.row.expectedUnits != null ? <span className="amt fade" key={data.buy?.quotedAt ?? data.generatedAt}>{fmtUnits(data.row.expectedUnits)}</span> : dash} {w.symbol}
    </>
  ) : (
    <>
      For {data.row.expectedUnits != null ? fmtUnits(data.row.expectedUnits) : dash} {w.symbol} you get{" "}
      {data.row.roundTripUsdc != null ? <span className="amt fade" key={data.generatedAt}>{fmtUsd(data.size + data.row.roundTripUsdc)}</span> : dash} USDC
    </>
  );
  const line2: React.ReactNode = !data ? (
    dash
  ) : data.row.premium == null ? (
    data.reference ? (
      <>
        Reference {fmtUsd(data.reference.price)} USD{" "}
        <span className="small muted">
          {data.reference.source}, {fmtAge(data.reference.ageSec)}
          {data.reference.stale ? ", from cache" : ""}
        </span>
        {data.reference.pythMark ? <span className="pyth-mark">PYTH</span> : null}
      </>
    ) : (
      noRef ?? "No reference for this token"
    )
  ) : (
    <>
      {Math.abs(data.row.premium * 100).toFixed(2)}% {data.row.premium >= 0 ? "above" : "below"} the reference ({fmtUsd(Math.abs(data.row.premiumUsd ?? 0), 0)} USD)
    </>
  );
  const roundTripPct = data?.row.roundTripPct ?? null;
  const line3: React.ReactNode = (
    <>Round trip about {roundTripPct != null ? `${(Math.abs(roundTripPct) * 100).toFixed(1)}%` : dash} if sold straight back</>
  );
  const left: { k: string; v: React.ReactNode }[] = [
    {
      k: "Reference",
      v: data ? (
        <>
          {data.reference ? <>{fmtUsd(data.reference.price)} USD<span className="detail">{data.reference.source}, {fmtAge(data.reference.ageSec)}{data.reference.stale ? ", from cache" : ""}{data.reference.pythMark ? <span className="pyth-mark">PYTH</span> : null}</span></> : noRef ?? "no reference available"}
          {data.pyth.index ? <span className="detail">Pyth index {fmtUsd(data.pyth.index.price)} USD, 24/7<span className="pyth-mark">PYTH</span></span> : null}
          {data.pyth.wrapperFeed ? <span className="detail">Pyth wrapper feed {fmtUsd(data.pyth.wrapperFeed.price)} USD<span className="pyth-mark">PYTH</span></span> : null}
          {data.pyth.redemptionRate ? <span className="detail">Redemption rate {data.pyth.redemptionRate.price.toFixed(6)} shares per raw token; mint multiplier {m.toFixed(6)}{Math.abs(data.pyth.redemptionRate.price - m) < 1e-5 ? ", agrees" : ", differs"}<span className="pyth-mark">PYTH</span></span> : null}
        </>
      ) : dash,
    },
    {
      k: "Pool price",
      v: data ? (
        <>{data.row.unitPrice != null ? <>{fmtUsd(data.row.unitPrice)} USD per unit at {fmtUsd(data.size, 0)} USDC before the fee{m !== 1 ? <span className="detail">{fmtUsd(data.row.rawPrice ?? 0)} per raw token, multiplier {m.toFixed(7)}</span> : null}<span className="detail">route {data.row.routeLabels.join(" + ") || "none"}{data.row.deliveryRatio != null && data.row.deliveryRatio < 0.9995 ? `, delivers ${data.row.deliveryRatio.toFixed(4)}x the quote` : ""}</span></> : data.row.noLiquidity ? "no on-chain liquidity" : data.quoteError ? `no route simulated: ${data.quoteError}` : "thin at this size"}</>
      ) : dash,
    },
    {
      k: "Premium",
      v: data ? (
        <>{data.row.premium != null ? <>{fmtPct(data.row.premium)} at this size<span className="detail">{data.row.premiumUsd != null && data.row.premiumUsd > 0 ? `${fmtUsd(data.row.premiumUsd, 0)} USD of your ${fmtUsd(data.size, 0)} is above the reference; at the reference this position is worth ${fmtUsd(data.size - data.row.premiumUsd, 0)} USD.` : data.row.premiumUsd != null ? `The pool is under the reference by ${fmtUsd(-data.row.premiumUsd, 0)} USD at this size.` : ""}</span>{data.row.belowMark ? <span className="detail warn">Below mark: no enforceable redemption at the mark; the discount is not a payout.</span> : null}</> : noRef ?? "no reference"}</>
      ) : dash,
    },
    {
      k: "US market",
      v: data ? (
        <>{c.kind === "public" ? data.market?.text ?? "unknown" : "Not applicable, private company."}<span className="detail">The pool trades 24/7.</span></>
      ) : dash,
    },
    {
      k: "Impact",
      v: data ? (
        <>{data.row.impact != null ? `${(data.row.impact * 100).toFixed(2)}% at this size` : "n/a"}{data.pool ? <span className="detail">pool liquidity {fmtUsd(data.pool.liquidityUsd, 0)} USD, 24h volume {fmtUsd(data.pool.volume24hUsd, 0)} USD{data.row.thin ? ", thin" : ""}</span> : null}</>
      ) : dash,
    },
    {
      k: "Expected",
      v: data ? (
        <>{data.row.expectedUnits != null ? <>{fmtUnits(data.row.expectedUnits)} {w.symbol}<span className="detail">quote{data.buy?.simulatedOutRaw ? " checked by simulation" : ""}, {fmtAge(quoteAge)}</span></> : "n/a"}</>
      ) : dash,
    },
    {
      k: "Minimum",
      v: data ? (
        <>{data.row.minimumUnits != null ? <>{fmtUnits(data.row.minimumUnits)} {w.symbol}<span className="detail">{data.buy?.slippageBps ?? 0} bps slippage; the only figure the chain enforces</span></> : "n/a"}</>
      ) : dash,
    },
  ];
  const right: { k: string; v: React.ReactNode }[] = [
    {
      k: "Fees in",
      v: data ? (
        <>Parsec {data.feeBps / 100}% ({fmtUsd(data.size * data.feeBps / 10_000)} USDC){data.legal.transferFeeBps ? `. ${issuerName[w.issuer]} ${data.legal.transferFeeBps / 100}% withheld inside the pool leg, none to Parsec.` : `. ${issuerName[w.issuer]} 0%.`}<span className="detail">Network and rent under 0.002 SOL.</span></>
      ) : dash,
    },
    {
      k: "Fees out",
      v: data ? (
        <>If sold now: Parsec {data.feeBps / 100}%{data.legal.transferFeeBps ? `, ${issuerName[w.issuer]} ${data.legal.transferFeeBps / 100}%` : ""}.</>
      ) : dash,
    },
    {
      k: "Round trip",
      v: data ? (
        <>{data.row.roundTripUsdc != null && data.row.roundTripPct != null ? <>{fmtUsd(data.size, 0)} → about {fmtUsd(data.size + data.row.roundTripUsdc, 0)} USDC ({fmtPct(data.row.roundTripPct, 1)}) if sold straight back.</> : "n/a"}</>
      ) : dash,
    },
    {
      k: "Compare",
      v: data ? (
        <>{data.row.compare.jupOutUnits != null ? <>Jupiter direct would deliver {fmtUnits(data.row.compare.jupOutUnits)} {w.symbol}{data.row.compare.deltaUnits != null ? (Math.abs(data.row.compare.deltaUnits) < 1e-6 ? ": same amount." : `: ${data.row.compare.deltaUnits > 0 ? "more" : "less"} by ${fmtUnits(Math.abs(data.row.compare.deltaUnits))}.`) : "."}</> : "Jupiter direct comparison unavailable"}</>
      ) : dash,
    },
    { k: "Routing", v: data ? "Metis (Jupiter Swap API)" : dash },
    {
      k: "Exit",
      v: data ? <span className="small" style={{ fontFamily: "var(--sans)" }}>{data.legal.redemption}</span> : dash,
    },
  ];

  return (
    <main>
      <p className="small muted">
        <Link href={`/c/${c.id}`}>{c.name}</Link> · {issuerName[w.issuer]}
      </p>
      <h1>
        {side === "buy" ? "Buy" : "Sell"} <span className="mono">{w.symbol}</span>
      </h1>

      <div className="strip">
        <label className="small muted" htmlFor="size">Size, USDC</label>
        <input id="size" inputMode="decimal" value={sizeInput} onChange={(e) => setSizeInput(e.target.value)} onBlur={() => setSize(Math.max(1, Number(sizeInput) || 1000))} style={{ width: "9em" }} />
        <div className="seg" role="group" aria-label="Side">
          <button aria-pressed={side === "buy"} onClick={() => setSide("buy")}>Buy</button>
          <button aria-pressed={side === "sell"} onClick={() => setSide("sell")}>Sell</button>
        </div>
      </div>

      {err ? <p className="warn">{err}</p> : null}

      <p className="sum">{line1}</p>
      <p className="sum">{line2}</p>
      {noPool ? null : <p className="sum">{line3}</p>}

      <div className="controls">
        <button onClick={buildAndSign} disabled={!connected || !data || data.row.noLiquidity}>Build swap, sign in wallet</button>
        {!connected ? <span className="small muted">Connect a wallet to build; the label works without one.</span> : null}
      </div>
      {status ? <p className="small">{status}</p> : null}

      {history === null ? null : history.candles.length === 0 ? (
        <p className="small muted">No price history.</p>
      ) : (
        <div className="chart">
          <PriceChart symbol={history.symbol} candles={history.candles} reference={history.reference?.price ?? null} range={hrange} onRange={setHrange} />
          <p className="small muted">
            Pool price from {history.pool!.dexId} via {history.source === "geckoterminal" ? "GeckoTerminal" : "Jupiter"}, {fmtAge(Math.floor(Date.now() / 1000) - history.fetchedAt)}
            {history.reference ? <>. Reference {history.reference.source}, {fmtAge(history.reference.ageSec)}</> : null}
          </p>
        </div>
      )}

      <details className="details" open={detailsOpen} onToggle={(e) => setDetailsOpen(e.currentTarget.open)}>
        <summary>Details</summary>
        <p className="small">{data?.legal.line ?? ""}</p>

        <div className="cols" aria-busy={loading}>
        <table className="kv">
          <tbody>
            {left.map((r) => (
              <tr key={r.k}>
                <td className="k">{r.k}</td>
                <td className="v">{r.v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="kv">
          <tbody>
            {right.map((r) => (
              <tr key={r.k}>
                <td className="k">{r.k}</td>
                <td className="v">{r.v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
        <p className="small muted">{data ? `Reference ${data.reference ? fmtAge(data.reference.ageSec) : "n/a"}, quote ${fmtAge(quoteAge)}, simulated.` : " "}</p>

      <p className="small muted">
        Sources: {data?.legal.sources.map((s, i) => <span key={s.url}>{i ? " · " : ""}<a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></span>)}. Formulas on <Link href="/rules">rules</Link>.
      </p>
      </details>

      {receipt ? (
        <dl className="label">
          <dt>Receipt</dt>
          <dd>
            <a href={`https://solscan.io/tx/${receipt.signature}`} target="_blank" rel="noreferrer">{receipt.signature.slice(0, 16)}…</a>
            <span className="detail">received {units(receipt.receivedRaw) || "pending"} · expected {units(receipt.expectedRaw)} · minimum {units(receipt.minimumRaw)}</span>
            {receipt.feeRaw ? <span className="detail">Parsec fee {fmtUsd(Number(receipt.feeRaw) / 1e6)} USDC to <a href={`https://solscan.io/account/${receipt.feeAccount}`} target="_blank" rel="noreferrer">the fee account</a></span> : null}
          </dd>
          {w.issuer === "tessera" && tessera && !tessera.registered && tessera.guard.ok ? (
            <>
              <dt>Referral</dt>
              <dd className="small" style={{ fontFamily: "var(--sans)" }}>
                Register this wallet under Parsec&apos;s Tessera code {tessera.code}. Costs about {(tessera.rentLamports / 1e9).toFixed(4)} SOL in rent, gives you nothing, earns Parsec 30% of Tessera&apos;s 0.2% fee on your future sells. Optional.
                <div style={{ marginTop: 8 }}><button className="secondary" onClick={registerTessera}>Register under Parsec&apos;s code</button></div>
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </main>
  );
}
