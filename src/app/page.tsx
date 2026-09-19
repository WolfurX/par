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
      <p className="muted">
        Each issuer&apos;s own reference price, the round-trip cost at your size with the fee printed, and what the token legally is,
        before you sign in your own wallet.
      </p>
      <div className="controls">
        <input aria-label="Search companies" placeholder="Search a company or ticker" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: "18em" }} />
      </div>
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Kind</th>
            <th>On-chain wrappers</th>
          </tr>
        </thead>
        <tbody>
          {list.map((c) => {
            const ws = wrappersForCompany(c.id);
            return (
              <tr key={c.id}>
                <td>
                  <Link href={`/c/${c.id}`}>{c.name}</Link> {c.ticker ? <span className="mono muted small">{c.ticker}</span> : null}
                </td>
                <td className="muted">{c.kind === "public" ? "listed" : "private"}</td>
                <td className="mono small">{ws.map((w) => w.symbol).join(" · ") || "none listed"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="small muted">
        Twelve seed companies for now. The holdings view labels any wrapper mint it finds in a wallet, listed here or not.
      </p>
    </main>
  );
}
