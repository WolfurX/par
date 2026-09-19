// Verify src/lib/rpc.ts against live on-chain mint state.
// Run: cd /home/rizki/projects/par && node --env-file=.env.local scripts/verify-rpc.mjs

import { getMintStates } from "../src/lib/rpc.ts";
import { wrappers } from "../src/lib/registry.ts";

const bySymbol = (sym) => wrappers.find((w) => w.symbol === sym);

const targets = [
  { symbol: "tOpenAI", expect: "9 dec, transferFeeBps 20, no delegate, no transfer hook program" },
  { symbol: "OPENAI", expect: "9 dec, multiplier ~1.4861347, feeBps 50, permanentDelegate set" },
  { symbol: "AAPLx", expect: "8 dec, multiplier ~1.0032690, permanentDelegate set, pausable" },
  { symbol: "SPCX.US", expect: "6 dec, permanentDelegate set, pausable" },
];

const mints = [];
for (const t of targets) {
  const w = bySymbol(t.symbol);
  if (!w) {
    console.error(`registry: no wrapper for symbol ${t.symbol}`);
    continue;
  }
  mints.push(w.mint);
}

console.log(`Fetching mint state for ${mints.length} mints (cache 60s)...\n`);
const start = Date.now();
const states = await getMintStates(mints);
console.log(`Done in ${Date.now() - start} ms\n`);

for (const t of targets) {
  const w = bySymbol(t.symbol);
  if (!w) continue;
  const s = states.get(w.mint);
  console.log(`--- ${t.symbol} (mint ${w.mint}) ---`);
  console.log(`  expected:              ${t.expect}`);
  if (!s) {
    console.log("  result:                NO DATA");
    continue;
  }
  console.log(`  program:               ${s.program}`);
  console.log(`  decimals:              ${s.decimals}`);
  console.log(`  supplyRaw:             ${s.supplyRaw}`);
  console.log(`  multiplier:            ${s.multiplier}`);
  console.log(`  multiplierChangesAt:   ${s.multiplierChangesAt ?? "none"}`);
  console.log(`  pendingMultiplier:     ${s.pendingMultiplier ?? "none"}`);
  console.log(`  transferFeeBps:        ${s.transferFeeBps}`);
  console.log(`  permanentDelegate:     ${s.permanentDelegate ?? "none"}`);
  console.log(`  freezeAuthority:       ${s.freezeAuthority ?? "none"}`);
  console.log(`  pausable / paused:     ${s.pausable} / ${s.paused}`);
  console.log(`  transferHookProgram:   ${s.transferHookProgram === undefined ? "no extension" : s.transferHookProgram === null ? "extension, no program" : s.transferHookProgram}`);
  console.log(`  transferHookAuthority: ${s.transferHookAuthority ?? "none"}`);
  console.log(`  defaultAccountFrozen:  ${s.defaultAccountFrozen}`);
  console.log(`  check:                 https://solscan.io/token/${w.mint}`);
  console.log();
}

// Second call within 60s should hit the in-memory cache (near-instant, no network).
const t2 = Date.now();
await getMintStates(mints);
console.log(`Second call (should be cache hits): ${Date.now() - t2} ms`);

// getTokenBalanceRaw sanity check against a known holder from research (PreStocks OPENAI).
const { getTokenBalanceRaw } = await import("../src/lib/rpc.ts");
const owner = "D8J5wMyQSfnPohtMdYSz7VEYsH8Uk4DXY5Me8jVc1BsW";
const openaiMint = bySymbol("OPENAI")?.mint;
if (openaiMint) {
  const bal = await getTokenBalanceRaw(owner, openaiMint);
  console.log(`\ngetTokenBalanceRaw(${owner}, OPENAI): ${bal.toString()} raw (expect 247169124497 per 2026-09-16 research)`);
}
