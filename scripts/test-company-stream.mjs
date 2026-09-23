// Reproduces the /api/company/[id] defects fixed in src/app/api/company/[id]/route.ts and
// src/lib/jupiter.ts: the route awaited every sized buy and sell quote before returning anything, and
// sized quotes were cached 30 s. No network; fetch and the clock are stubbed.
// Run: node --test scripts/test-company-stream.mjs

import test from "node:test";
import assert from "node:assert/strict";

// src/lib uses extensionless imports and the "@/lib/x" alias (Next resolves both); node needs the
// extension and a real path, so add a hook. "@/x" maps to src/x; a failed resolve of a spec with no
// extension retries with ".ts" for relative and file: specs, and with ".js" for bare specs (next/server).
import { register } from "node:module";
const SRC = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(
      "const SRC = " +
        JSON.stringify(SRC) +
        ";" +
        "export async function resolve(spec, ctx, next) {" +
        "  if (spec.startsWith('@/')) spec = SRC + spec.slice(2);" +
        "  try { return await next(spec, ctx); } catch (e) {" +
        "    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]sx?$/.test(spec)) return next(spec + '.ts', ctx);" +
        "    if (!spec.startsWith('.') && !spec.startsWith('file:') && !/\\.[cm]?[jt]sx?$/.test(spec)) return next(spec + '.js', ctx);" +
        "    throw e; } }",
    ),
);

delete process.env.HELIUS_API_KEY;
delete process.env.JUPITER_API_KEY;
delete process.env.PYTH_PRO_API_KEY;
delete process.env.FEE_BPS;
delete process.env.DEXSCREENER_BASE_OVERRIDE;
delete process.env.JUPITER_WINDOW_CALLS;

let now = Date.parse("2026-09-23T12:00:00Z");
Date.now = () => now;

let orders = 0; // every /swap/v2/order call
let small = 0; // /swap/v2/order calls at amount=5000000 (the test-3 direct quoteAtSize calls)
let resolveHeld;
const held = new Promise((resolve) => (resolveHeld = resolve));

globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
  if (url.startsWith("https://api.dexscreener.com/token-pairs/v1/solana/")) {
    const mint = url.split("/").pop();
    return Response.json([
      { baseToken: { address: mint }, quoteToken: { symbol: "USDC" }, dexId: "stub", pairAddress: "stub", priceUsd: "1000", liquidity: { usd: 100000 }, volume: { h24: 5000 } },
    ]);
  }
  if (url.startsWith("https://rest-api.tessera.pe/v1/public/token-details")) {
    return Response.json([{ code: "tOpenAI", markPrice: 1100 }]);
  }
  if (url.includes("/swap/v2/order")) {
    orders++;
    if (/[?&]amount=5000000(&|$)/.test(url)) small++;
    await held;
    return Response.json({ outAmount: "1000000000", otherAmountThreshold: "990000000", routePlan: [] });
  }
  throw new TypeError("offline");
};

const { GET } = await import("../src/app/api/company/[id]/route.ts");
const { quoteAtSize } = await import("../src/lib/jupiter.ts");

/** Races p against ms; the timer never keeps the process alive. */
function within(p, ms, what) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what}: not within ${ms} ms`)), ms);
    t.unref();
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Returns the next parsed NDJSON line off res.body, or null at end of stream. */
function lineReader(res) {
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  return async function next() {
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        return JSON.parse(line);
      }
      const { value, done } = await reader.read();
      if (done) return null;
      buf += value;
    }
  };
}

// The tests below run in order and share the reader.
let reader;

test("the frame line arrives while every sized quote is still outstanding", async () => {
  const d = await within(
    (async () => {
      const res = await GET(new Request("http://localhost/api/company/openai"), { params: Promise.resolve({ id: "openai" }) });
      reader = lineReader(res);
      return reader();
    })(),
    3000,
    "frame line",
  );

  assert.equal(d.quoted, false);
  assert.equal(d.company.name, "OpenAI");
  assert.deepEqual(
    d.rows.map((r) => r.symbol).sort(),
    ["OPENAI", "tOpenAI"],
  );
  for (const r of d.rows) {
    assert.equal(r.unitPrice, null);
    assert.equal(r.premium, null);
    assert.equal(r.quotedAt, null);
  }
  const tOpenAI = d.rows.find((r) => r.symbol === "tOpenAI");
  assert.equal(tOpenAI.reference.price, 1100);
});

test("the second line carries the sized quotes and ends the stream", async () => {
  resolveHeld();
  const d = await within(reader(), 3000, "quoted line");

  assert.equal(d.quoted, true);
  for (const r of d.rows) {
    assert.equal(r.unitPrice, 999);
    assert.equal(r.quotedAt, Math.floor(now / 1000));
  }
  const tOpenAI = d.rows.find((r) => r.symbol === "tOpenAI");
  assert.ok(Math.abs(tOpenAI.premium - -101 / 1100) < 1e-12);
  assert.equal(tOpenAI.belowMark, true);
  const openai = d.rows.find((r) => r.symbol === "OPENAI");
  assert.equal(openai.premium, null);
  assert.equal(openai.belowMark, false);

  assert.equal(await reader(), null);
});

test("a sized quote is served from cache for 120 s", async () => {
  const mint = "oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ"; // tOpenAI

  now += 20_000; // clear the keyless 5-per-11-s window
  const s0 = small;
  await quoteAtSize(mint, "buy", "5000000");
  assert.equal(small, s0 + 1);

  now += 119_000;
  await quoteAtSize(mint, "buy", "5000000");
  assert.equal(small, s0 + 1); // still cached at 119 s

  now += 2_000;
  await quoteAtSize(mint, "buy", "5000000");
  assert.equal(small, s0 + 2); // refetched past 120 s
});
