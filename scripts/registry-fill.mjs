// Fetches missing registry facts from issuer APIs, verifies each on-chain, and prints a patch
// for src/lib/registry.ts. This script only prints; it does not write the file.
// Run from the repo root: node --env-file=.env.local scripts/registry-fill.mjs

import { PublicKey } from "@solana/web3.js";
import { getConnection } from "../src/lib/rpc.ts";
import { PYTH_PUSH_ORACLE_PROGRAM, PYTH_CORE_SHARD } from "../src/lib/registry.ts";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// --- 1. Hermes feed ids for TSLA, NVDA, SPY, MU ---
async function hermesFeedId(sym) {
  const want = `Equity.US.${sym}/USD`;
  const list = await getJson(`https://hermes.pyth.network/v2/price_feeds?query=${sym}`);
  const hit = list.find((f) => f.attributes?.symbol === want);
  return hit ? { feedId: hit.id, raw: hit } : null;
}

// --- 2. Pyth Pro id for MU ---
async function pythProId(sym) {
  const want = `Equity.US.${sym}/USD`;
  const list = await getJson(`https://history.pyth-lazer.dourolabs.app/history/v1/symbols?query=${sym}`);
  const hit = list.find((s) => s.symbol === want);
  return hit ? hit.pyth_lazer_id : null;
}

// --- 3. xStocks mint for a symbol (e.g. "MUx", "SPCXx") ---
async function xstocksMint(symbol) {
  let asset;
  try {
    asset = await getJson(`https://api.xstocks.fi/api/v2/public/assets/${symbol}`);
  } catch (e) {
    return { error: e.message };
  }
  const dep = (asset.deployments ?? []).find((d) => d.network === "Solana");
  return dep ? { mint: dep.address, raw: asset } : { error: "no Solana deployment" };
}

// --- 4. Backpack SPY.US mint ---
async function backpackMint(symbol) {
  const assets = await getJson("https://api.backpack.exchange/api/v1/assets");
  const asset = assets.find((a) => a.symbol === symbol);
  if (!asset) return { error: `symbol ${symbol} not found` };
  const tok = (asset.tokens ?? []).find((t) => t.blockchain === "Solana");
  return tok?.contractAddress ? { mint: tok.contractAddress, raw: asset } : { error: "no Solana contract address" };
}

// --- 5. On-chain verification: owner program, decimals, tokenMetadata name ---
async function verifyMint(conn, mint, expectDecimals, expectName) {
  const info = await conn.getParsedAccountInfo(new PublicKey(mint));
  if (!info.value) return { ok: false, reason: "account not found" };
  const owner = info.value.owner.toBase58();
  const parsed = info.value.data?.parsed;
  if (!parsed || parsed.type !== "mint") return { ok: false, reason: "not a parsed mint account" };
  const program = owner === TOKEN_2022_PROGRAM ? "token-2022" : owner === TOKEN_PROGRAM ? "token" : owner;
  const decimals = parsed.info.decimals;
  const tokenMetadata = (parsed.info.extensions ?? []).find((e) => e.extension === "tokenMetadata")?.state;
  const name = tokenMetadata?.name ?? null;
  const ok =
    program === "token-2022" &&
    (expectDecimals === undefined || decimals === expectDecimals) &&
    (expectName === undefined || (name ?? "").includes(expectName));
  const reasons = [];
  if (program !== "token-2022") reasons.push(`program=${program}`);
  if (expectDecimals !== undefined && decimals !== expectDecimals) reasons.push(`decimals=${decimals}`);
  if (expectName !== undefined && !(name ?? "").includes(expectName)) reasons.push(`name=${JSON.stringify(name)}`);
  return { ok, program, decimals, name, reason: ok ? undefined : reasons.join(" ") };
}

// --- 6. Pyth Core shard-1 account existence ---
async function shardAccountExists(conn, feedIdHex) {
  const shardBuf = Buffer.alloc(2);
  shardBuf.writeUInt16LE(PYTH_CORE_SHARD);
  const [pda] = PublicKey.findProgramAddressSync(
    [shardBuf, Buffer.from(feedIdHex, "hex")],
    new PublicKey(PYTH_PUSH_ORACLE_PROGRAM),
  );
  const info = await conn.getAccountInfo(pda);
  return { pda: pda.toBase58(), exists: info !== null };
}

async function main() {
  const conn = getConnection();
  console.log("=== registry-fill: fetching and verifying ===\n");

  // Hermes feed ids
  console.log("--- Pyth Hermes feed ids (Equity.US.<SYM>/USD) ---");
  const feedIds = {};
  for (const sym of ["TSLA", "NVDA", "SPY", "MU"]) {
    const hit = await hermesFeedId(sym);
    feedIds[sym] = hit?.feedId ?? null;
    console.log(`  ${sym}: ${hit ? hit.feedId : "NOT FOUND"}`);
  }

  // MU Pro id
  console.log("\n--- Pyth Pro id (history.pyth-lazer.dourolabs.app) ---");
  const muProId = await pythProId("MU");
  console.log(`  MU Equity.US.MU/USD pyth_lazer_id: ${muProId ?? "NOT FOUND"}`);

  // xStocks mints
  console.log("\n--- xStocks mints (api.xstocks.fi) ---");
  const xstocksResults = {};
  for (const sym of ["MUx", "SPCXx"]) {
    const r = await xstocksMint(sym);
    xstocksResults[sym] = r;
    if (r.mint) {
      const v = await verifyMint(conn, r.mint, 8, r.raw?.name);
      console.log(`  ${sym}: mint=${r.mint} on-chain=${JSON.stringify(v)}`);
    } else {
      console.log(`  ${sym}: ${r.error}`);
    }
  }

  // Backpack SPY.US mint
  console.log("\n--- Backpack mint (api.backpack.exchange) ---");
  const spyUs = await backpackMint("SPY.US");
  if (spyUs.mint) {
    const v = await verifyMint(conn, spyUs.mint, 6, spyUs.raw?.displayName);
    console.log(`  SPY.US: mint=${spyUs.mint} on-chain=${JSON.stringify(v)}`);
  } else {
    console.log(`  SPY.US: ${spyUs.error}`);
  }

  // Pyth Core shard-1 accounts for TSLA, NVDA, SPY, MU
  console.log("\n--- Pyth Core shard-1 account check (program " + PYTH_PUSH_ORACLE_PROGRAM + ") ---");
  const shardResults = {};
  for (const sym of ["TSLA", "NVDA", "SPY", "MU"]) {
    const feedId = feedIds[sym];
    if (!feedId) {
      console.log(`  ${sym}: skipped, no feed id`);
      continue;
    }
    const r = await shardAccountExists(conn, feedId);
    shardResults[sym] = r;
    console.log(`  ${sym}: pda=${r.pda} exists=${r.exists}`);
  }

  // --- Print the patch ---
  console.log("\n=== PATCH for src/lib/registry.ts ===\n");
  console.log("companies[]:");
  for (const sym of ["TSLA", "NVDA", "SPY", "MU"]) {
    if (feedIds[sym]) console.log(`  ${sym}: pythEquityFeedId: "${feedIds[sym]}"${sym === "MU" && muProId ? `, pythEquityProId: ${muProId}` : ""}`);
  }
  console.log("\nwrappers[] reference switch to pyth-core (only where the shard-1 account exists):");
  for (const sym of ["TSLA", "NVDA", "SPY", "MU"]) {
    const exists = shardResults[sym]?.exists;
    const feedId = feedIds[sym];
    if (exists && feedId) console.log(`  ${sym} wrappers -> { kind: "pyth-core", feedId: "${feedId}" }`);
    else console.log(`  ${sym} wrappers -> leave as-is (no shard-1 account or no feed id)`);
  }
  console.log("\nnew wrapper rows:");
  if (xstocksResults.MUx?.mint) console.log(`  MUx: mint=${xstocksResults.MUx.mint}`);
  if (xstocksResults.SPCXx?.mint) console.log(`  SPCXx: mint=${xstocksResults.SPCXx.mint}`);
  if (spyUs.mint) console.log(`  SPY.US: mint=${spyUs.mint}`);

  console.log("\nDone. Verify each printed mint against an explorer before hand-editing registry.ts.");
}

main().catch((e) => {
  console.error("registry-fill failed:", e);
  process.exit(1);
});
