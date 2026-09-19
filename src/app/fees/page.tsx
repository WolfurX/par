"use client";

import { Fragment, useEffect, useState } from "react";
import { fmtUnits, fmtUsd } from "@/lib/units";

interface Ledger {
  feeWallet: string;
  usdcFeeAccount: string;
  tesseraAccounts: { symbol: string; ata: string }[];
  totals: Record<string, number>;
  entries: { signature: string; time: number; kind: "fee" | "referral" | "other"; amount: number; symbol: string; from?: string }[];
  generatedAt: number;
}

export default function FeesPage() {
  const [data, setData] = useState<Ledger | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/fees").then(async (r) => { if (!r.ok) throw new Error((await r.json()).error ?? r.statusText); return r.json(); }).then(setData).catch((e) => setErr(String(e.message ?? e)));
  }, []);
  return (
    <main>
      <h1>Fee ledger</h1>
      <p className="muted">Everything Par has collected, read from the chain. The swap fee lands in USDC; Tessera referral payouts arrive as T-Tokens from Tessera&apos;s fee manager in batches.</p>
      {err ? <p className="warn">{err}</p> : null}
      {!data && !err ? <p className="muted">Reading the fee accounts.</p> : null}
      {data ? (
        <>
          <dl className="label">
            <dt>Fee wallet</dt>
            <dd><a href={`https://solscan.io/account/${data.feeWallet}`} target="_blank" rel="noreferrer">{data.feeWallet}</a></dd>
            <dt>USDC account</dt>
            <dd><a href={`https://solscan.io/account/${data.usdcFeeAccount}`} target="_blank" rel="noreferrer">{data.usdcFeeAccount}</a></dd>
            {data.tesseraAccounts.map((t) => (
              <Fragment key={t.ata}>
                <dt>{t.symbol}</dt>
                <dd><a href={`https://solscan.io/account/${t.ata}`} target="_blank" rel="noreferrer">{t.ata}</a></dd>
              </Fragment>
            ))}
            <dt>Totals</dt>
            <dd>{Object.keys(data.totals).length ? Object.entries(data.totals).map(([s, v]) => `${s === "USDC" ? fmtUsd(v) : fmtUnits(v, 6)} ${s}`).join(" · ") : "nothing collected yet"}</dd>
          </dl>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Kind</th>
                <th className="num">Amount</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.signature}>
                  <td className="small">{e.time ? new Date(e.time * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC" : ""}</td>
                  <td>{e.kind === "fee" ? "swap fee" : e.kind === "referral" ? "Tessera referral" : "transfer in"}</td>
                  <td className="num mono">{e.symbol === "USDC" ? fmtUsd(e.amount) : fmtUnits(e.amount, 6)} {e.symbol}</td>
                  <td className="mono small"><a href={`https://solscan.io/tx/${e.signature}`} target="_blank" rel="noreferrer">{e.signature.slice(0, 12)}…</a></td>
                </tr>
              ))}
              {data.entries.length === 0 ? <tr><td colSpan={4} className="muted">No entries yet.</td></tr> : null}
            </tbody>
          </table>
        </>
      ) : null}
    </main>
  );
}
