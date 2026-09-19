"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { companyById } from "@/lib/registry";
import { fmtAge, fmtPct, fmtUnits, fmtUsd } from "@/lib/units";

interface HoldingRow {
  mint: string;
  wrapper?: { symbol: string; issuer: string; name: string; companyId: string; decimals: number };
  label?: { symbol: string; issuer: string; name: string };
  balanceRaw: string;
  balanceUnits: number;
  state: { multiplier: number; transferFeeBps: number; paused: boolean };
  powers: string;
  nextEvent?: { at?: number; text: string; sourceUrl?: string };
}
interface SellPanel { unitPrice: number | null; premium: number | null; sellUsdc: number | null; reference: { price: number; source: string; ageSec: number } | null; legalRedemption: string; belowMark: boolean }

const issuerName: Record<string, string> = { xstocks: "xStocks (Backed)", ondo: "Ondo", backpack: "Backpack", tessera: "Tessera", prestocks: "PreStocks" };

export default function HoldingsPage() {
  const { publicKey } = useWallet();
  const [addr, setAddr] = useState("");
  const [owner, setOwner] = useState<string | null>(null);
  const [rows, setRows] = useState<HoldingRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [panels, setPanels] = useState<Record<string, SellPanel | "loading">>({});

  useEffect(() => {
    if (publicKey && !owner) setOwner(publicKey.toBase58());
  }, [publicKey, owner]);

  useEffect(() => {
    if (!owner) return;
    setRows(null);
    setErr(null);
    setPanels({});
    fetch(`/api/holdings?owner=${owner}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        return r.json();
      })
      .then((d) => setRows(d.holdings ?? d))
      .catch((e) => setErr(String(e.message ?? e)));
  }, [owner]);

  async function loadPanel(h: HoldingRow) {
    if (!h.wrapper) return;
    setPanels((p) => ({ ...p, [h.mint]: "loading" }));
    try {
      const r = await fetch(`/api/label?mint=${h.mint}&size=${Math.max(1, Math.round(h.balanceUnits * 100) / 100)}`);
      const d = await r.json();
      // Sell quote of the whole balance
      const s = await fetch(`/api/quote?mint=${h.mint}&side=sell&amount=${h.balanceRaw}`);
      const q = s.ok ? await s.json() : null;
      setPanels((p) => ({
        ...p,
        [h.mint]: {
          unitPrice: d.row?.unitPrice ?? null,
          premium: d.row?.premium ?? null,
          sellUsdc: q?.expectedRaw && q.expectedRaw !== "0" ? Number(q.expectedRaw) / 1e6 : null,
          reference: d.reference ?? null,
          legalRedemption: d.legal?.redemption ?? "",
          belowMark: !!d.row?.belowMark,
        },
      }));
    } catch {
      setPanels((p) => { const c = { ...p }; delete c[h.mint]; return c; });
    }
  }

  return (
    <main>
      <h1>What you hold, explained</h1>
      <p className="muted">Connect a wallet or paste an address. Every wrapper mint is read live: balance as your wallet shows it, what it legally is, what the issuer can do to it, and the next dated event.</p>
      <div className="controls">
        <WalletMultiButton />
        <span className="small muted">or</span>
        <input aria-label="Wallet address" placeholder="Paste a Solana address" value={addr} onChange={(e) => setAddr(e.target.value)} style={{ minWidth: "26em" }} />
        <button className="secondary" onClick={() => addr.trim() && setOwner(addr.trim())}>Read</button>
      </div>
      {owner ? <p className="small mono muted">{owner}</p> : null}
      {err ? <p className="warn">{err}</p> : null}
      {owner && !rows && !err ? <p className="muted">Reading token accounts and mint state.</p> : null}
      {rows && rows.length === 0 ? <p className="muted">No tokenized-stock wrappers in this wallet.</p> : null}

      {rows?.map((h) => {
        const sym = h.wrapper?.symbol ?? h.label?.symbol ?? h.mint.slice(0, 8);
        const iss = h.wrapper?.issuer ?? h.label?.issuer ?? "unknown";
        const isPrivate = iss === "tessera" || iss === "prestocks";
        const panel = panels[h.mint];
        const company = h.wrapper ? companyById.get(h.wrapper.companyId) : undefined;
        return (
          <section key={h.mint} style={{ marginTop: 28 }}>
            <h2 style={{ marginTop: 0 }}>
              <span className="mono">{sym}</span> <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>{issuerName[iss] ?? iss}{company ? <> · <Link href={`/c/${company.id}`}>{company.name}</Link></> : null}</span>
            </h2>
            <dl className="label">
              <dt>Balance</dt>
              <dd>{fmtUnits(h.balanceUnits, 6)} {sym}<span className="detail">{h.balanceRaw} raw × {h.state.multiplier.toFixed(7)}</span></dd>
              <dt>Powers</dt>
              <dd>{h.powers}</dd>
              <dt>Next event</dt>
              <dd>{h.nextEvent ? <>{h.nextEvent.text}{h.nextEvent.sourceUrl ? <span className="detail"><a href={h.nextEvent.sourceUrl} target="_blank" rel="noreferrer">source</a></span> : null}</> : "none announced"}</dd>
              {h.wrapper ? (
                <>
                  <dt>Value</dt>
                  <dd>
                    {!panel ? <button className="secondary" onClick={() => loadPanel(h)}>Quote this position</button> : panel === "loading" ? "quoting…" : (
                      <>
                        {panel.sellUsdc != null ? `${fmtUsd(panel.sellUsdc)} USDC if sold now` : "no route at this size"}
                        {panel.reference ? <span className="detail">at the reference ({panel.reference.source}, {fmtAge(panel.reference.ageSec)}): {fmtUsd(h.balanceUnits * panel.reference.price)} USD{panel.premium != null ? `; pool ${fmtPct(panel.premium)} to reference` : ""}</span> : null}
                      </>
                    )}
                  </dd>
                  {isPrivate && panel && panel !== "loading" ? (
                    <>
                      <dt>Sell now</dt>
                      <dd>{panel.sellUsdc != null ? `${fmtUsd(panel.sellUsdc)} USDC after fees` : "no route"}<span className="detail"><Link href={`/c/${h.wrapper.companyId}/${encodeURIComponent(h.wrapper.symbol)}`}>Build the sell on the label</Link></span></dd>
                      <dt>Mark value</dt>
                      <dd>{panel.reference ? `${fmtUsd(h.balanceUnits * panel.reference.price)} USD at the issuer's mark (not a payout)` : "no mark"}<span className="detail">Issuer commitment: {panel.legalRedemption}</span>{panel.belowMark ? <span className="detail warn">Pool is under the mark; no redemption at the mark is enforceable.</span> : panel.premium != null && panel.premium > 0 ? <span className="detail">Pool pays {fmtPct(panel.premium)} above mark today.</span> : null}</dd>
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <dt>Label</dt>
                  <dd className="small" style={{ fontFamily: "var(--sans)" }}>Recognised by on-chain metadata as a {issuerName[iss] ?? iss} wrapper not in the seed list; the issuer line applies, the quote does not.</dd>
                </>
              )}
            </dl>
          </section>
        );
      })}
    </main>
  );
}
