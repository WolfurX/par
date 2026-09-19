// Jupiter Price v3: one call per company for row mids (usdPrice is per scaled unit; scaledUiConfig is attached).
// Used only for company-page mids. The label page quotes at size through jupiter.ts.

export interface JupMid {
  mint: string;
  usdPricePerUnit: number; // per scaled unit
  usdPricePerRaw?: number; // usdPricePrescaled when present
  multiplier?: number;
  stockData?: { id: string; price: number; updatedAt?: string }; // Jupiter's own issuer mark (wrong for Tessera; do not use as reference)
  fetchedAt: number;
}

const cache = new Map<string, { at: number; value: Map<string, JupMid> }>();
const TTL_MS = 30_000;

function base(): string {
  return process.env.JUPITER_API_KEY ? "https://api.jup.ag/price/v3" : "https://lite-api.jup.ag/price/v3";
}

export async function getMids(mints: string[]): Promise<Map<string, JupMid>> {
  const key = [...mints].sort().join(",");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const headers: Record<string, string> = { accept: "application/json" };
  if (process.env.JUPITER_API_KEY) headers["x-api-key"] = process.env.JUPITER_API_KEY;
  const out = new Map<string, JupMid>();
  try {
    const res = await fetch(`${base()}?ids=${mints.join(",")}`, { headers, next: { revalidate: 30 } });
    if (res.ok) {
      const data = (await res.json()) as Record<string, Record<string, unknown>>;
      for (const mint of mints) {
        const d = data[mint];
        if (!d) continue;
        const usdPrice = Number(d.usdPrice);
        if (!Number.isFinite(usdPrice) || usdPrice <= 0) continue;
        const sc = d.scaledUiConfig as { multiplier?: number; newMultiplier?: number; usdPricePrescaled?: number; newMultiplierEffectiveAt?: string } | undefined;
        const sd = d.stockData as { id?: string; price?: number; updatedAt?: string } | undefined;
        out.set(mint, {
          mint,
          usdPricePerUnit: usdPrice,
          usdPricePerRaw: sc?.usdPricePrescaled ? Number(sc.usdPricePrescaled) : undefined,
          multiplier: sc?.newMultiplier && sc.newMultiplierEffectiveAt && Date.parse(sc.newMultiplierEffectiveAt) <= Date.now() ? Number(sc.newMultiplier) : sc?.multiplier ? Number(sc.multiplier) : undefined,
          stockData: sd?.id && sd?.price ? { id: sd.id, price: Number(sd.price), updatedAt: sd.updatedAt } : undefined,
          fetchedAt: Math.floor(Date.now() / 1000),
        });
      }
    }
  } catch {
    // leave empty; callers print "no mid"
  }
  if (out.size) cache.set(key, { at: Date.now(), value: out });
  else if (hit) return hit.value;
  return out;
}
