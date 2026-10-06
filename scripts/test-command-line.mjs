// The title bar command line (src/app/(app)/CommandLine.tsx) resolves input with parseCommand in
// src/app/(app)/command-parse.ts, which is pure. Expected hrefs are worked by hand from src/lib/registry.ts:
// aapl L17 (name Apple, ticker AAPL), spcx L22, djt L24 (name Trump Media), openai L26 (no ticker),
// figure L30 (name Figure AI), tOpenAI L62 (tessera, openai), OPENAI L67 (prestocks, openai),
// SPACEX L70 (prestocks, spcx).
// Run: node --test scripts/test-command-line.mjs

import test from "node:test";
import assert from "node:assert/strict";

// No resolve hook: command-parse.ts has no imports and registry.ts has only `import type`, which Node strips.
const { parseCommand } = await import("../src/app/(app)/command-parse.ts");
const { companies, wrappersForCompany } = await import("../src/lib/registry.ts");
const list = companies.map((c) => ({ id: c.id, name: c.name, ticker: c.ticker, wrappers: wrappersForCompany(c.id).map((w) => w.symbol) }));

test("company id with a size opens the company page at that size", () => {
  assert.equal(parseCommand("openai 1000", list), "/c/openai?size=1000");
});

test("upper case OPENAI resolves to the company, not the PreStocks wrapper", () => {
  // Company id openai (L26) comes before the PreStocks wrapper symbol OPENAI (L67) in parser precedence;
  // that wrapper's buy screen is reached from the company page, not the command line.
  assert.equal(parseCommand("OPENAI 1000", list), "/c/openai?size=1000");
});

test("k suffix multiplies the size and liq sorts by liquidity", () => {
  assert.equal(parseCommand("aapl 5k liq", list), "/c/aapl?size=5000&sort=liquidity");
});

test("company id alone opens the company page with no params", () => {
  assert.equal(parseCommand("spcx", list), "/c/spcx");
});

test("wrapper symbol with a size opens that wrapper's buy screen in canonical casing", () => {
  assert.equal(parseCommand("tOpenAI 500", list), "/c/openai/tOpenAI?size=500");
});

test("wrapper symbol without a size opens the company page", () => {
  assert.equal(parseCommand("tOpenAI", list), "/c/openai");
});

test("unknown input is no match", () => {
  assert.equal(parseCommand("zzz", list), null);
});

test("company name prefix resolves when no id, ticker or symbol equals the input", () => {
  assert.equal(parseCommand("apple", list), "/c/aapl");
});

test("exact wrapper symbol comes before a company name prefix", () => {
  // SPACEX (L70) is an exact symbol; SpaceX (L22) would only match by name prefix.
  assert.equal(parseCommand("spacex 100", list), "/c/spcx/SPACEX?size=100");
});

test("multi-word name prefix with a size", () => {
  assert.equal(parseCommand("trump media 1000", list), "/c/djt?size=1000");
});

test("multi-word name prefix without a size", () => {
  assert.equal(parseCommand("figure ai", list), "/c/figure");
});

test("leftover tokens after the size are no match", () => {
  assert.equal(parseCommand("openai 1000 foo", list), null);
});

test("a name prefix shared by two companies is no match", () => {
  // `an` starts Anthropic (L28) and Anduril (L32).
  assert.equal(parseCommand("an 100", list), null);
});

test("size 0 is no match", () => {
  assert.equal(parseCommand("aapl 0", list), null);
});

test("a ticker that differs from the id resolves by ticker", () => {
  // Every registry ticker equals its upper-cased id, so the ticker branch needs its own fixture.
  const fixture = [{ id: "x1", name: "Foo Corp", ticker: "FOO", wrappers: [] }];
  assert.equal(parseCommand("foo 200", fixture), "/c/x1?size=200");
});
