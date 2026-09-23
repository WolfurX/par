// Verifies src/lib/holdings.ts against the live Helius endpoints directly (no import from the .ts
// module, so this is a real independent check, not a re-run of the same arithmetic).
//
// Run from the repo root: node --env-file=.env.local scripts/verify-holdings.mjs

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL;
if (!RPC_URL) {
  console.error("NEXT_PUBLIC_RPC_URL is not set");
  process.exit(1);
}

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "verify-holdings", method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message ?? JSON.stringify(json.error)}`);
  return json.result;
}

function effectiveMultiplier(cfg, nowSec) {
  if (!cfg) return 1;
  if (cfg.newMultiplierEffectiveTimestamp > 0 && nowSec >= cfg.newMultiplierEffectiveTimestamp) return cfg.newMultiplier;
  return cfg.multiplier;
}

function rawToUnits(raw, decimals, multiplier) {
  return (Number(BigInt(raw)) / 10 ** decimals) * multiplier;
}

// Mirrors registry.ts (mints pinned by address, never resolve by symbol).
const wrapperByMint = new Map(
  [
    { mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", issuer: "xstocks", symbol: "AAPLx" },
    { mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", issuer: "xstocks", symbol: "TSLAx" },
    { mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", issuer: "xstocks", symbol: "NVDAx" },
    { mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", issuer: "xstocks", symbol: "SPYx" },
    { mint: "123mYEnRLM2LLYsJW3K6oyYh8uP1fngj732iG638ondo", issuer: "ondo", symbol: "AAPLon" },
    { mint: "KeGv7bsfR4MheC1CkmnAVceoApjrkvBhHYjWb67ondo", issuer: "ondo", symbol: "TSLAon" },
    { mint: "gEGtLTPNQ7jcg25zTetkbmF7teoDLcrfTnQfmn2ondo", issuer: "ondo", symbol: "NVDAon" },
    { mint: "k18WJUULWheRkSpSquYGdNNmtuE2Vbw1hpuUi92ondo", issuer: "ondo", symbol: "SPYon" },
    { mint: "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb", issuer: "backpack", symbol: "SPCX.US" },
    { mint: "MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1", issuer: "backpack", symbol: "MU.US" },
    { mint: "AAPLEDt8RpzPgXyhvFzkMBofvFSQw9gpeMCoUdPdLnB8", issuer: "backpack", symbol: "AAPL.US" },
    { mint: "TSLAqBbv4CNCnzWFeB7LmydAyEiNMJtve7DYKLpdK4S", issuer: "backpack", symbol: "TSLA.US" },
    { mint: "NVDAVuiB7hwd3m5Wa1JuHNovPaPG6BH1QNztbKFxNjv", issuer: "backpack", symbol: "NVDA.US" },
    { mint: "oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ", issuer: "tessera", symbol: "tOpenAI" },
    { mint: "TKLSidmLVt3cqGaaodG8tyRzoANfQwoh67AccjmubeZ", issuer: "tessera", symbol: "tKalshi" },
    { mint: "TSPXcLV76s6V2zDiZQ18kBfcbnjaE2ZzNT3ga2Pd99v", issuer: "tessera", symbol: "tSpaceX" },
    { mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", issuer: "prestocks", symbol: "OPENAI" },
    { mint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua", issuer: "prestocks", symbol: "KALSHI" },
    { mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw", issuer: "prestocks", symbol: "ANTHROPIC" },
    { mint: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh", issuer: "prestocks", symbol: "SPACEX" },
    { mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP", issuer: "prestocks", symbol: "POLYMARKET" },
    { mint: "PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd", issuer: "prestocks", symbol: "FIGUREAI" },
    { mint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S", issuer: "prestocks", symbol: "NEURALINK" },
    { mint: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB", issuer: "prestocks", symbol: "ANDURIL" },
  ].map((w) => [w.mint, w]),
);
const issuerUpdateAuthorities = {
  "5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq": "xstocks",
  "9foMHsSDq7nMg4WPusSz9eY7tyxyukqborA8GyU5cUxD": "ondo",
};
const issuerMintPrefixes = [{ prefix: "Pre", issuer: "prestocks" }];

function identifyUnknownWrapper(mint, item) {
  const meta = item.content?.metadata ?? item.mint_extensions?.metadata;
  const updateAuthority = item.mint_extensions?.metadata?.update_authority;
  const name = meta?.name;
  const symbol = meta?.symbol ?? mint.slice(0, 6);
  let issuer = updateAuthority ? issuerUpdateAuthorities[updateAuthority] : undefined;
  if (!issuer) {
    const prefixed = issuerMintPrefixes.find((p) => mint.startsWith(p.prefix));
    if (prefixed) issuer = prefixed.issuer;
    else if (name?.endsWith("- Backpack Securities")) issuer = "backpack";
  }
  return issuer ? { mint, issuer, symbol, name: name ?? symbol } : null;
}

function parseMintState(owner, info, currentEpoch) {
  const program = owner === TOKEN_2022_PROGRAM ? "token-2022" : "token";
  const byType = new Map((info.extensions ?? []).map((e) => [e.extension, e.state]));
  const scaled = byType.get("scaledUiAmountConfig");
  const multiplierCfg = scaled
    ? { multiplier: Number(scaled.multiplier ?? "1"), newMultiplier: Number(scaled.newMultiplier ?? "1"), newMultiplierEffectiveTimestamp: Number(scaled.newMultiplierEffectiveTimestamp ?? 0) }
    : null;
  const feeCfg = byType.get("transferFeeConfig");
  let transferFeeBps = 0;
  if (feeCfg) {
    const newer = feeCfg.newerTransferFee;
    const older = feeCfg.olderTransferFee;
    transferFeeBps = newer && currentEpoch >= Number(newer.epoch) ? Number(newer.transferFeeBasisPoints) : Number(older?.transferFeeBasisPoints ?? 0);
  }
  const permanentDelegate = byType.get("permanentDelegate")?.delegate;
  const pausableCfg = byType.get("pausableConfig");
  const hook = byType.get("transferHook");
  const defaultState = byType.get("defaultAccountState");
  return {
    program,
    decimals: info.decimals,
    multiplierCfg,
    transferFeeBps,
    permanentDelegate,
    freezeAuthority: info.freezeAuthority ?? undefined,
    paused: pausableCfg?.paused ?? false,
    pausable: !!pausableCfg,
    transferHookProgram: hook ? (hook.programId ?? null) : undefined,
    defaultAccountFrozen: defaultState?.accountState === "frozen",
  };
}

function formatPowers(state) {
  const hook = state.transferHookProgram ? state.transferHookProgram : "none";
  return (
    `freeze: ${state.freezeAuthority ? "yes" : "no"} · ` +
    `permanent delegate: ${state.permanentDelegate ? "yes" : "no"} · ` +
    `paused: ${state.paused ? "yes" : "no"} · ` +
    `transfer hook: ${hook} · ` +
    `transfer fee ${(state.transferFeeBps / 100).toString()}%`
  );
}

async function holdingsForOwner(owner) {
  const [assets, epochInfo] = await Promise.all([
    rpc("getAssetsByOwner", { ownerAddress: owner, page: 1, limit: 1000, displayOptions: { showFungible: true, showZeroBalance: false } }),
    rpc("getEpochInfo", []),
  ]);
  const items = (assets.items ?? []).filter(
    (it) => it.interface === "FungibleToken" && it.token_info?.balance != null && (it.token_info.token_program === TOKEN_PROGRAM || it.token_info.token_program === TOKEN_2022_PROGRAM),
  );
  const mints = items.map((i) => i.id);
  const accounts = mints.length ? (await rpc("getMultipleAccounts", [mints, { encoding: "jsonParsed" }])).value : [];
  const nowSec = Math.floor(Date.now() / 1000);

  const rows = [];
  items.forEach((item, i) => {
    const acc = accounts[i];
    const info = acc?.data?.parsed?.info;
    if (!info) return;
    const wrapper = wrapperByMint.get(item.id) ?? identifyUnknownWrapper(item.id, item);
    if (!wrapper) return;
    const state = parseMintState(acc.owner, info, epochInfo.epoch);
    const multiplier = effectiveMultiplier(state.multiplierCfg, nowSec);
    const balanceRaw = String(item.token_info.balance);
    const units = rawToUnits(balanceRaw, item.token_info.decimals, multiplier);
    rows.push({ mint: item.id, issuer: wrapper.issuer, symbol: wrapper.symbol, balanceRaw, decimals: item.token_info.decimals, multiplier, units, powers: formatPowers(state) });
  });
  return rows;
}

async function crossCheckOne(owner, mint) {
  const res = await rpc("getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed" }]);
  const acc = res.value?.[0]?.account?.data?.parsed?.info?.tokenAmount;
  return acc ? { amountRaw: acc.amount, uiAmount: acc.uiAmount } : null;
}

async function main() {
  console.log("Parsec holdings verification -- run against live Helius mainnet RPC\n");

  for (const owner of ["D8J5wMyQSfnPohtMdYSz7VEYsH8Uk4DXY5Me8jVc1BsW", "2sujbbTjp2r5ugbjfHgUNDSwtdVfYpTiCSKPgT84CvD7"]) {
    console.log(`=== ${owner} ===`);
    const rows = await holdingsForOwner(owner);
    if (rows.length === 0) console.log("  (no recognized holdings)");
    for (const r of rows) {
      console.log(`  ${r.issuer}/${r.symbol}  mint=${r.mint}`);
      console.log(`    raw=${r.balanceRaw}  decimals=${r.decimals}  multiplier=${r.multiplier}  units=${r.units}`);
      console.log(`    powers: ${r.powers}`);
    }
    console.log();
  }

  console.log("=== cross-check: getTokenAccountsByOwner(jsonParsed) vs getHoldings math ===");
  const openaiMint = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
  const rpcSide = await crossCheckOne("D8J5wMyQSfnPohtMdYSz7VEYsH8Uk4DXY5Me8jVc1BsW", openaiMint);
  const dasSide = (await holdingsForOwner("D8J5wMyQSfnPohtMdYSz7VEYsH8Uk4DXY5Me8jVc1BsW")).find((r) => r.mint === openaiMint);
  console.log(`  RPC jsonParsed uiAmount (already scaled): ${rpcSide?.uiAmount}  (raw ${rpcSide?.amountRaw})`);
  console.log(`  DAS balance x effective multiplier:        ${dasSide?.units}  (raw ${dasSide?.balanceRaw} x ${dasSide?.multiplier})`);
  const agree = rpcSide && dasSide && Math.abs(rpcSide.uiAmount - dasSide.units) < 1e-6;
  console.log(`  agree: ${agree}`);
  console.log(`  research snapshot 2026-09-16 expected ~367.326612683 units from ~247.169124497 raw (balance drifts with fee harvests; compare shape, not the exact digits).`);

  console.log("\n=== why MintState is not read from DAS mint_extensions ===");
  const dasAsset = await rpc("getAsset", { id: openaiMint });
  const hasScaled = "scaled_ui_amount_config" in (dasAsset.mint_extensions ?? {});
  const dasFeeBps = dasAsset.mint_extensions?.transfer_fee_config?.newer_transfer_fee?.transfer_fee_basis_points;
  const rpcAcc = await rpc("getAccountInfo", [openaiMint, { encoding: "jsonParsed" }]);
  const rpcFee = rpcAcc.value.data.parsed.info.extensions.find((e) => e.extension === "transferFeeConfig")?.state.newerTransferFee.transferFeeBasisPoints;
  console.log(`  DAS getAsset mint_extensions has scaled_ui_amount_config: ${hasScaled} (expected true if DAS were reliable here)`);
  console.log(`  transfer fee bps -- DAS mint_extensions: ${dasFeeBps}  vs  getAccountInfo(jsonParsed): ${rpcFee}  (getHoldings uses the latter)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
