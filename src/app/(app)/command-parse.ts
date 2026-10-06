// Parser for the title bar command line (CommandLine.tsx). Pure and import-free, so scripts/test-command-line.mjs
// loads it without React.
//
// Grammar: <company id | ticker | company name prefix | wrapper symbol> [size in USDC, digits with optional k] [sort].
// All matching is case-insensitive and runs against the pinned registry list passed in, nothing else. Precedence:
// 1 company id, 2 ticker, 3 exact wrapper symbol, 4 company name prefix (only when exactly one name matches). So
// `openai` is the company (id), not PreStocks OPENAI, whose buy screen is reached from the company page; `spacex` is
// the PreStocks wrapper (exact symbol before name prefix); `apple` is Apple; `an` matches both Anthropic and Anduril
// and is no match.

export type CommandCompany = { id: string; name: string; ticker?: string; wrappers: string[] };

const SORTS: Record<string, string> = { price: "price", liq: "liquidity", liquidity: "liquidity", redeemable: "redeemable", terms: "terms" };

/** The href for a command, or null when nothing in the list matches. */
export function parseCommand(input: string, companies: CommandCompany[]): string | null {
  // Parse from the right so multi-word names resolve. A trailing number is always read as a size, so
  // `spdr s&p 500` is SPY at size 500.
  const t = input.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const sort = t.length && Object.hasOwn(SORTS, t[t.length - 1]) ? SORTS[t.pop()!] : undefined;
  const m = t.length ? /^([1-9]\d*)(k?)$/.exec(t[t.length - 1]) : null;
  if (m) t.pop();
  const size = m ? Number(m[1]) * (m[2] ? 1000 : 1) : undefined;
  const target = t.join(" ");
  if (!target) return null;

  const byKey =
    companies.find((c) => c.id.toLowerCase() === target) ?? companies.find((c) => c.ticker?.toLowerCase() === target);
  const bySymbol = byKey
    ? undefined
    : companies.flatMap((c) => c.wrappers.map((symbol) => ({ c, symbol }))).find((x) => x.symbol.toLowerCase() === target);
  const byName = companies.filter((c) => c.name.toLowerCase().startsWith(target));
  const company = byKey ?? bySymbol?.c ?? (byName.length === 1 ? byName[0] : undefined);
  if (!company) return null;

  const qs = new URLSearchParams();
  if (size !== undefined) qs.set("size", String(size));
  if (sort) qs.set("sort", sort);
  const path = bySymbol && size !== undefined ? `/c/${company.id}/${encodeURIComponent(bySymbol.symbol)}` : `/c/${company.id}`;
  const q = qs.toString();
  return q ? `${path}?${q}` : path;
}
