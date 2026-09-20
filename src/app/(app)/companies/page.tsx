"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { companies, wrappersForCompany } from "@/lib/registry";

export default function Home() {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return companies.filter((c) => !s || c.name.toLowerCase().includes(s) || (c.ticker ?? "").toLowerCase().includes(s) || c.id.includes(s));
  }, [q]);
  return (
    <main>
      <h1>Every on-chain way to own a company, on one label.</h1>
      <div className="controls">
        <input aria-label="Search companies" placeholder="Search a company or ticker" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: "18em" }} />
      </div>
      <div className="row-list">
        {list.map((c, i) => {
          const ws = wrappersForCompany(c.id);
          return (
            <div className="row" key={c.id}>
              <div className="rank">{i + 1}</div>
              <div>
                <div className="head">
                  <Link href={`/c/${c.id}`}>{c.name}</Link>
                  {c.ticker ? <span className="mono muted small">{c.ticker}</span> : null}
                  <span className="issuer">{c.kind === "public" ? "listed" : "private"}</span>
                </div>
                <div className="nums">{ws.map((w) => w.symbol).join(" · ") || "none listed"}</div>
              </div>
              <div className="act">
                <Link href={`/c/${c.id}`}>Compare {ws.length} {ws.length === 1 ? "wrapper" : "wrappers"}</Link>
              </div>
            </div>
          );
        })}
      </div>
      <p className="small muted">
        {companies.length} companies listed today. The portfolio view labels any wrapper mint it finds in a wallet, listed here or not.
      </p>
    </main>
  );
}
