"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { companies, wrappersForCompany } from "@/lib/registry";

// Arrow Up/Down move between rows in DOM order, from any link in a row or from the search box (i is -1 there,
// so ArrowDown lands on row 1). Enter is the link's own activation; no tabindex, so Tab order and clicks are untouched.
function RowNav({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        const rows = Array.from(ref.current!.querySelectorAll<HTMLElement>(".row"));
        const i = rows.findIndex((r) => r.contains(document.activeElement));
        const next = rows[e.key === "ArrowDown" ? i + 1 : i - 1]?.querySelector<HTMLAnchorElement>("a.name");
        if (next) {
          e.preventDefault();
          next.focus();
        }
      }}
    >
      {children}
    </div>
  );
}

export default function Home() {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return companies.filter((c) => !s || c.name.toLowerCase().includes(s) || (c.ticker ?? "").toLowerCase().includes(s) || c.id.includes(s));
  }, [q]);
  return (
    <main>
      <h1>A company&apos;s tokens on Solana, side by side at your size.</h1>
      <RowNav>
        <div className="controls">
          <input aria-label="Search companies" placeholder="Search a company or ticker" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: "18em" }} />
        </div>
        <div className="row-list">
          {list.map((c, i) => {
            const ws = wrappersForCompany(c.id);
            return (
              <div className="row" key={c.id}>
                <span className="rank">{i + 1}</span>
                <Link href={`/c/${c.id}`} className="name">{c.name}</Link>
                <span className="muted">{c.ticker}</span>
                <span className="muted">{c.kind === "public" ? "listed" : "private"}</span>
                <span className="syms">{ws.map((w) => w.symbol).join("  ")}</span>
                <Link href={`/c/${c.id}`} className="act">{ws.length} {ws.length === 1 ? "wrapper" : "wrappers"}</Link>
              </div>
            );
          })}
        </div>
      </RowNav>
      <p className="small muted">
        {companies.length} companies listed today. The portfolio view labels any wrapper mint it finds in a wallet, listed here or not.
      </p>
    </main>
  );
}
