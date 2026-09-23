// Per-mint route exclusions in src/lib/jupiter.ts. The buy screen's build ladder dropped a leg that made the
// simulation revert for that one build only and never recorded it, so the matrix quote (which honours
// excludedDexesFor) kept pricing a leg the buy screen could not use. recordRevert records a leg on its second revert
// for the same mint within the exclusion window. No network; the clock is stubbed.
// Run: node --test scripts/test-exclusions.mjs

import test from "node:test";
import assert from "node:assert/strict";

// src/lib uses extensionless imports and the "@/lib/x" alias (Next resolves both); node needs the
// extension and a real path, so add a hook, the same one scripts/test-company-stream.mjs uses.
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

let now = Date.parse("2026-09-23T12:00:00Z");
Date.now = () => now;

const { recordRevert, excludedDexesFor } = await import("../src/lib/jupiter.ts");
const OPENAI = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
const HOUR = 60 * 60 * 1000;

test("one revert only arms the record; the second within the hour excludes the leg", () => {
  assert.equal(recordRevert(OPENAI, "Manifest"), false);
  assert.deepEqual(excludedDexesFor(OPENAI), []);
  now += 10 * 60 * 1000;
  assert.equal(recordRevert(OPENAI, "Manifest"), true);
  assert.deepEqual(excludedDexesFor(OPENAI), ["Manifest"]);
});

test("the exclusion lapses an hour after it was recorded", () => {
  now += HOUR - 1000;
  assert.deepEqual(excludedDexesFor(OPENAI), ["Manifest"]);
  now += 2000;
  assert.deepEqual(excludedDexesFor(OPENAI), []);
});

test("two reverts more than an hour apart do not exclude", () => {
  assert.equal(recordRevert(OPENAI, "Meteora DLMM"), false);
  now += HOUR + 1000;
  assert.equal(recordRevert(OPENAI, "Meteora DLMM"), false);
  assert.deepEqual(excludedDexesFor(OPENAI), []);
});

test("reverts are counted per mint and per leg", () => {
  const TOPENAI = "oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ";
  assert.equal(recordRevert(TOPENAI, "GoonFi V2"), false);
  assert.equal(recordRevert(OPENAI, "GoonFi V2"), false);
  assert.equal(recordRevert(TOPENAI, "BisonFi"), false);
  assert.deepEqual(excludedDexesFor(TOPENAI), []);
  assert.deepEqual(excludedDexesFor(OPENAI), []);
});

test("a second revert under a minute after the first is the same moment and excludes nothing", () => {
  const M = "PreANxuXjsy2vsy5d4D5c5ZnRqGBf8JqmnqLMkvnBYQf";
  assert.equal(recordRevert(M, "Meteora DLMM"), false);
  now += 1000; // ladder() step 1 re-simulates about a second later
  assert.equal(recordRevert(M, "Meteora DLMM"), false);
  assert.deepEqual(excludedDexesFor(M), []);
  now += 59_000; // a minute after the arming revert
  assert.equal(recordRevert(M, "Meteora DLMM"), true);
  assert.deepEqual(excludedDexesFor(M), ["Meteora DLMM"]);
});
