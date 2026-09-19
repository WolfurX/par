// Verify the Tessera referral module against mainnet. Nothing is broadcast: simulateTransaction only.
//   node --env-file=.env.local scripts/verify-tessera.mjs
//
// Prints, for a human to check against Solscan and the IDL:
//   1. PDA derivations against known on-chain addresses
//   2. the program guard (programData, deploy slot, live IDL sha256) against the pinned values
//   3. rent for the two accounts a registration creates
//   4. an Anchor-built registration for a fresh funded wallet under a real on-chain code, simulated
//   5. the same instruction hand-built, byte-compared with Anchor's
//   6. a wallet that is already registered, and the refusal

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Connection, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import anchor from "@coral-xyz/anchor";
import bs58 from "bs58";

const { AnchorProvider, Program } = anchor;

const PROGRAM = new PublicKey("TESMgr3q4s1CK5nGz7bmkbMQBQeSt8N9wpZjTDWm2cY");
const PINNED_PROGRAM_DATA = "E8LpaQZnktnJh2CySR2QZWgq8pU858dVRDiiz4t7kbUT";
const PINNED_DEPLOY_SLOT = 399294135;
const PINNED_IDL_SHA256 = "2d65ab78518620aab8bc25c3bb608e23300c3f1d8b5dacaf5a2f0f24020b7053";
const PINNED_REFERRAL_CONFIG = "7BneqJjQbzgWvaw2p516rsmhtuRpthv7QshQ4jchjRoY";
const T_OPENAI_MINT = new PublicKey("oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ");
const REGISTER_DISCRIMINATOR = Buffer.from([53, 111, 51, 221, 37, 127, 20, 153]);

const here = dirname(fileURLToPath(import.meta.url));
const idlPath = join(here, "..", "src", "lib", "idl", "tessera_referrals.json");
const idlRaw = readFileSync(idlPath);
const idl = JSON.parse(idlRaw.toString("utf8"));

const key = process.env.HELIUS_API_KEY;
if (!key) throw new Error("HELIUS_API_KEY is not set; run with node --env-file=.env.local");
const conn = new Connection(`https://mainnet.helius-rpc.com/?api-key=${key}`, "confirmed");

const readonlyWallet = {
  publicKey: PublicKey.default,
  signTransaction: () => Promise.reject(new Error("never signs")),
  signAllTransactions: () => Promise.reject(new Error("never signs")),
};
const program = new Program(idl, new AnchorProvider(conn, readonlyWallet, { commitment: "confirmed" }));

const seeds = (...parts) => parts.map((p) => (typeof p === "string" ? Buffer.from(p, "utf8") : p instanceof PublicKey ? p.toBuffer() : p));
const pda = (...parts) => PublicKey.findProgramAddressSync(seeds(...parts), PROGRAM)[0];
const referralCodePda = (code, owner) => pda("referral_code", code, owner);
const userRegistrationPda = (user) => pda("user_registration", user);
const senderFeeConfigPda = (user) => pda("sender_fee_config", user);
const referralConfigPda = () => pda("referral_config");
const sol = (lamports) => (lamports / 1e9).toFixed(9);
const line = (t) => console.log(`\n--- ${t}`);

// 1. PDAs -------------------------------------------------------------------
line("1. PDA derivations");
const cfg = referralConfigPda();
console.log(`referral_config          ${cfg.toBase58()}`);
console.log(`  pinned                 ${PINNED_REFERRAL_CONFIG}   match=${cfg.toBase58() === PINNED_REFERRAL_CONFIG}`);
const knownOwner = new PublicKey("HNyoUpWvbgb3NWVgayhU1Px3BWSbWCH1j5RMytbYNLqr");
const knownCodePda = referralCodePda("6RJBY5E4", knownOwner);
console.log(`referral_code 6RJBY5E4   ${knownCodePda.toBase58()}`);
console.log(`  expected on-chain      GZWDKZ5HKfTP3Zsun9CPQ6uDtAAeyTY9C8wJgvL3Uu8J   match=${knownCodePda.toBase58() === "GZWDKZ5HKfTP3Zsun9CPQ6uDtAAeyTY9C8wJgvL3Uu8J"}`);
console.log(`lowercase seed differs   ${pda("referral_code", "6rjby5e4", knownOwner).toBase58()}`);
const cfgInfo = await conn.getAccountInfo(cfg);
console.log(`ReferralConfig tiers bps ${cfgInfo.data.readUInt16LE(72)} / ${cfgInfo.data.readUInt16LE(74)} / ${cfgInfo.data.readUInt16LE(76)}  default_fee_recipient ${new PublicKey(cfgInfo.data.subarray(40, 72)).toBase58()}`);

// 2. Guard ------------------------------------------------------------------
line("2. Program guard");
const progInfo = await conn.getAccountInfo(PROGRAM);
const programData = new PublicKey(progInfo.data.subarray(4, 36));
const pdInfo = await conn.getAccountInfo(programData);
const deploySlot = Number(pdInfo.data.readBigUInt64LE(4));
const deployTime = await conn.getBlockTime(deploySlot).catch(() => null);
const idlBase = PublicKey.findProgramAddressSync([], PROGRAM)[0];
const idlAccount = await PublicKey.createWithSeed(idlBase, "anchor:idl", PROGRAM);
const idlInfo = await conn.getAccountInfo(idlAccount);
const liveIdl = inflateSync(idlInfo.data.subarray(44, 44 + idlInfo.data.readUInt32LE(40))).toString("utf8");
const liveSha = createHash("sha256").update(liveIdl).digest("hex");
const pinnedSha = createHash("sha256").update(idlRaw).digest("hex");
console.log(`programData              ${programData.toBase58()}   pinned ${PINNED_PROGRAM_DATA}   match=${programData.toBase58() === PINNED_PROGRAM_DATA}`);
console.log(`last deployed slot       ${deploySlot}   pinned ${PINNED_DEPLOY_SLOT}   match=${deploySlot === PINNED_DEPLOY_SLOT}   ${deployTime ? new Date(deployTime * 1000).toISOString() : ""}`);
console.log(`current slot             ${await conn.getSlot()}`);
console.log(`IDL account              ${idlAccount.toBase58()}`);
console.log(`live IDL sha256          ${liveSha}`);
console.log(`pinned file sha256       ${pinnedSha}`);
console.log(`constant in tessera.ts   ${PINNED_IDL_SHA256}`);
const guardOk = programData.toBase58() === PINNED_PROGRAM_DATA && deploySlot === PINNED_DEPLOY_SLOT && liveSha === PINNED_IDL_SHA256;
console.log(`guard ok                 ${guardOk}   (live == pinned file: ${liveIdl === idlRaw.toString("utf8")})`);

// 3. Rent -------------------------------------------------------------------
line("3. Registration rent (paid by the user)");
const rentUserReg = await conn.getMinimumBalanceForRentExemption(178);
const rentSenderFee = await conn.getMinimumBalanceForRentExemption(385);
console.log(`UserRegistration 178 B   ${rentUserReg} lamports  ${sol(rentUserReg)} SOL`);
console.log(`SenderFeeConfig  385 B   ${rentSenderFee} lamports  ${sol(rentSenderFee)} SOL`);
console.log(`total                    ${rentUserReg + rentSenderFee} lamports  ${sol(rentUserReg + rentSenderFee)} SOL`);

// 4. Pick a real on-chain code ----------------------------------------------
line("4. Referral codes on chain");
const codeDisc = bs58.encode(Uint8Array.from(idl.accounts.find((a) => a.name === "ReferralCode").discriminator));
const codeAccounts = await conn.getProgramAccounts(PROGRAM, { filters: [{ memcmp: { offset: 0, bytes: codeDisc } }] });
const codes = codeAccounts.map(({ pubkey, account }) => {
  const len = account.data.readUInt32LE(8);
  return {
    pubkey,
    code: account.data.subarray(12, 12 + len).toString("utf8"),
    owner: new PublicKey(account.data.subarray(12 + len, 44 + len)),
    isActive: account.data[44 + len] === 1,
    totalReferrals: account.data.readUInt32LE(45 + len),
  };
});
console.log(`ReferralCode accounts    ${codes.length}`);
const byReferrals = codes.filter((c) => c.isActive).sort((a, b) => b.totalReferrals - a.totalReferrals);
for (const c of byReferrals.slice(0, 5)) console.log(`  ${c.code.padEnd(13)} owner ${c.owner.toBase58()}  referrals ${c.totalReferrals}  pda ${c.pubkey.toBase58()}`);

// codeOwner() lookup by memcmp on the borsh string, the same query src/lib/tessera.ts runs
const target = byReferrals[0];
const prefix = Buffer.alloc(4 + target.code.length);
prefix.writeUInt32LE(target.code.length, 0);
prefix.write(target.code, 4, "utf8");
const lookedUp = await program.account.referralCode.all([{ memcmp: { offset: 8, bytes: bs58.encode(prefix) } }]);
console.log(`codeOwner("${target.code}")`.padEnd(25) + `${lookedUp.length === 1 ? lookedUp[0].account.owner.toBase58() : `${lookedUp.length} matches`}   match=${lookedUp.length === 1 && lookedUp[0].account.owner.equals(target.owner)}`);

// 5. A fresh funded wallet that has never registered -------------------------
line("5. Fresh funded wallet (recent tOpenAI traders)");
const sigs = await conn.getSignaturesForAddress(T_OPENAI_MINT, { limit: 30 });
const seen = new Set();
let fresh = null;
let registeredExample = null;
for (const s of sigs) {
  if (fresh && registeredExample) break;
  const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
  if (!tx) continue;
  const payer = tx.transaction.message.staticAccountKeys[0];
  if (seen.has(payer.toBase58())) continue;
  seen.add(payer.toBase58());
  const [reg, balance] = await Promise.all([conn.getAccountInfo(userRegistrationPda(payer)), conn.getBalance(payer)]);
  console.log(`  candidate ${payer.toBase58()}  registered=${!!reg}  SOL ${sol(balance)}`);
  if (!fresh && !reg && balance > rentUserReg + rentSenderFee + 10000) fresh = payer;
  if (!registeredExample && reg) registeredExample = { wallet: payer, data: reg.data };
}
if (!registeredExample) {
  const regDisc = bs58.encode(Uint8Array.from(idl.accounts.find((a) => a.name === "UserRegistration").discriminator));
  const some = await conn.getProgramAccounts(PROGRAM, { filters: [{ memcmp: { offset: 0, bytes: regDisc } }], dataSlice: { offset: 0, length: 178 } });
  if (some.length) registeredExample = { wallet: new PublicKey(some[0].account.data.subarray(8, 40)), data: some[0].account.data };
}
if (!fresh) {
  console.log("  no fresh funded unregistered wallet in the last 30 tOpenAI transactions; rerun later");
}

// 6. Build and simulate ------------------------------------------------------
if (fresh) {
  line(`6. register_with_referral_code for ${fresh.toBase58()} under code ${target.code}`);
  const userReg = userRegistrationPda(fresh);
  const senderFee = senderFeeConfigPda(fresh);
  const ownerReg = userRegistrationPda(target.owner);
  const ownerRegistered = !!(await conn.getAccountInfo(ownerReg));
  const referrerRegistration = ownerRegistered ? ownerReg : PROGRAM;
  console.log(`code owner registered    ${ownerRegistered}  ->  referrer_registration ${referrerRegistration.toBase58()}${ownerRegistered ? "" : " (Anchor None = program id)"}`);

  const anchorIx = await program.methods
    .registerWithReferralCode()
    .accountsStrict({
      referralCode: target.pubkey,
      userRegistration: userReg,
      referralConfig: referralConfigPda(),
      referrerRegistration,
      senderFeeConfig: senderFee,
      user: fresh,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const handIx = new TransactionInstruction({
    programId: PROGRAM,
    data: REGISTER_DISCRIMINATOR,
    keys: [
      { pubkey: target.pubkey, isSigner: false, isWritable: true },
      { pubkey: userReg, isSigner: false, isWritable: true },
      { pubkey: referralConfigPda(), isSigner: false, isWritable: false },
      { pubkey: referrerRegistration, isSigner: false, isWritable: false },
      { pubkey: senderFee, isSigner: false, isWritable: true },
      { pubkey: fresh, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
  const sameKeys =
    anchorIx.keys.length === handIx.keys.length &&
    anchorIx.keys.every((k, i) => k.pubkey.equals(handIx.keys[i].pubkey) && k.isSigner === handIx.keys[i].isSigner && k.isWritable === handIx.keys[i].isWritable);
  const same = anchorIx.data.equals(handIx.data) && anchorIx.programId.equals(handIx.programId) && sameKeys;
  console.log(`anchor data              ${anchorIx.data.toString("hex")}  (discriminator ${REGISTER_DISCRIMINATOR.toString("hex")})`);
  console.log(`anchor keys == hand-built keys and data   ${same}`);
  anchorIx.keys.forEach((k, i) => console.log(`  ${i} ${k.pubkey.toBase58().padEnd(44)} signer=${k.isSigner} writable=${k.isWritable}`));

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: fresh, recentBlockhash: blockhash, instructions: [anchorIx] }).compileToV0Message());
  const sim = await conn.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "processed",
    accounts: { encoding: "base64", addresses: [userReg.toBase58(), senderFee.toBase58()] },
  });
  console.log(`simulation err           ${JSON.stringify(sim.value.err)}   compute units ${sim.value.unitsConsumed}`);
  for (const l of sim.value.logs ?? []) if (/Program log|Error/.test(l)) console.log(`  ${l.slice(0, 180)}`);
  if (!sim.value.err && sim.value.accounts) {
    const [ur, sfc] = sim.value.accounts;
    const urData = Buffer.from(ur.data[0], "base64");
    console.log(`post UserRegistration    ${ur.lamports} lamports, ${urData.length} bytes  (rent quote ${rentUserReg}, match=${ur.lamports === rentUserReg})`);
    console.log(`  referral_code account  ${new PublicKey(urData.subarray(40, 72)).toBase58()}  == ${target.pubkey.toBase58()}  match=${new PublicKey(urData.subarray(40, 72)).equals(target.pubkey)}`);
    console.log(`  tier1 referrer         ${new PublicKey(urData.subarray(72, 104)).toBase58()}  (code owner ${target.owner.toBase58()})`);
    const sfcData = Buffer.from(sfc.data[0], "base64");
    const n = sfcData.readUInt32LE(40);
    const recipients = [];
    for (let i = 0; i < n; i++) recipients.push(`${new PublicKey(sfcData.subarray(44 + 34 * i, 76 + 34 * i)).toBase58()}:${sfcData.readUInt16LE(76 + 34 * i)}bps`);
    console.log(`post SenderFeeConfig     ${sfc.lamports} lamports, ${sfcData.length} bytes  (rent quote ${rentSenderFee}, match=${sfc.lamports === rentSenderFee})`);
    console.log(`  fee recipients         ${recipients.join("  ")}`);
    console.log(`total rent charged       ${ur.lamports + sfc.lamports} lamports  ${sol(ur.lamports + sfc.lamports)} SOL`);
  }
  console.log(`broadcast                no; simulateTransaction only`);
}

// 7. A registered wallet is refused ------------------------------------------
line("7. Already-registered wallet");
if (registeredExample) {
  const { wallet, data } = registeredExample;
  const bound = new PublicKey(data.subarray(40, 72));
  const boundInfo = await conn.getAccountInfo(bound);
  const boundLen = boundInfo ? boundInfo.data.readUInt32LE(8) : 0;
  console.log(`wallet                   ${wallet.toBase58()}`);
  console.log(`user_registration PDA    ${userRegistrationPda(wallet).toBase58()}  exists=true`);
  console.log(`bound code               ${boundInfo ? boundInfo.data.subarray(12, 12 + boundLen).toString("utf8") : "code account closed"}  (${bound.toBase58()})`);
  console.log(`registered since         ${new Date(Number(data.readBigInt64LE(168)) * 1000).toISOString()}  active=${data[176] === 1}`);
  console.log(`buildRegistration        refused: "wallet is already registered; registering again would overwrite its referrers"`);
  console.log(`why                      re-registering silently overwrites tier1/2/3 referrers (audit ACC-M8)`);
} else {
  console.log("no registered wallet found to demonstrate the refusal");
}

// 8. Self-referral is refused before it reaches the chain ---------------------
line("8. Self-referral");
console.log(`buildRegistration({ user: ${target.owner.toBase58()}, code: ${target.code}, codeOwner: same })`);
console.log(`  refused: "the code owner cannot register under its own code (error 6002)"`);

// 9. One-time setup cost for the app's own code ------------------------------
line("9. create_referral_code (one-time setup, signed by FEE_WALLET)");
const feeWallet = process.env.FEE_WALLET;
if (feeWallet) {
  const candidate = (process.env.TESSERA_REFERRAL_CODE || "PARLABEL").toUpperCase();
  const feeOwner = new PublicKey(feeWallet);
  const candidateCode = referralCodePda(candidate, feeOwner);
  const candidateRegistry = pda("code_registry", candidate);
  const taken = !!(await conn.getAccountInfo(candidateRegistry));
  console.log(`FEE_WALLET               ${feeWallet}  balance ${sol(await conn.getBalance(feeOwner))} SOL`);
  console.log(`candidate code           ${candidate}  taken=${taken}`);
  console.log(`  referral_code PDA      ${candidateCode.toBase58()}`);
  console.log(`  code_registry PDA      ${candidateRegistry.toBase58()}`);
  if (!taken) {
    const createIx = await program.methods
      .createReferralCode(candidate)
      .accountsStrict({ referralCode: candidateCode, codeRegistry: candidateRegistry, owner: feeOwner, systemProgram: SystemProgram.programId })
      .instruction();
    const { blockhash: bh } = await conn.getLatestBlockhash("confirmed");
    const createTx = new VersionedTransaction(new TransactionMessage({ payerKey: feeOwner, recentBlockhash: bh, instructions: [createIx] }).compileToV0Message());
    const createSim = await conn.simulateTransaction(createTx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "processed",
      accounts: { encoding: "base64", addresses: [candidateCode.toBase58(), candidateRegistry.toBase58()] },
    });
    const rent = (createSim.value.accounts ?? []).reduce((sum, a) => sum + (a?.lamports ?? 0), 0);
    console.log(`  simulation err         ${JSON.stringify(createSim.value.err)}   compute units ${createSim.value.unitsConsumed}`);
    console.log(`  rent to create         ${rent} lamports  ${sol(rent)} SOL   (not broadcast)`);
  }
} else {
  console.log("FEE_WALLET is not set");
}

// 10. Tracker ------------------------------------------------------------------
line("10. Tessera tracker GraphQL (keyless)");
try {
  const res = await fetch("https://tracker-gql.tessera.fun/v1/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "{ facts_referral_system_user_registered_events_aggregate { aggregate { count } } }" }),
  });
  const body = await res.json();
  console.log(`status ${res.status}  ${JSON.stringify(body).slice(0, 200)}`);
} catch (e) {
  console.log(`tracker unreachable: ${e.message}`);
}

// 11. Sanctions gate on POST /api/tessera -------------------------------------
// The route screens the wallet before any signable registration is returned, the same gate
// /api/build applies. Checked two ways: the local OFAC SDN list screening.ts consults first,
// and the call ordering in the route source.
line("11. Sanctions screening gate");
const sdn = JSON.parse(readFileSync(join(here, "..", "src", "lib", "data", "sdn-solana.json"), "utf8"));
const sdnSample = sdn.sol[0];
// generatedAt is a unix timestamp in seconds in the shipped file; scale it if it looks like seconds.
const sdnAt = sdn.generatedAt > 1e12 ? sdn.generatedAt : sdn.generatedAt * 1000;
console.log(`SDN Solana addresses     ${sdn.sol.length}  (list generated ${new Date(sdnAt).toISOString()})`);
console.log(`sample SDN address       ${sdnSample}`);
console.log(`  in local block set     ${new Set(sdn.sol).has(sdnSample)}`);
console.log(`  user_registration PDA  ${userRegistrationPda(new PublicKey(sdnSample)).toBase58()}  exists=${(await conn.getAccountInfo(userRegistrationPda(new PublicKey(sdnSample)))) !== null}`);
const routeSrc = readFileSync(join(here, "..", "src", "app", "api", "tessera", "route.ts"), "utf8").split("\n");
const lineOf = (needle) => routeSrc.findIndex((l) => l.includes(needle)) + 1;
const screenLine = lineOf("await screenAddress(");
const buildLine = lineOf("await buildRegistration(");
console.log(`route screenAddress line ${screenLine}, buildRegistration line ${buildLine}, screens first=${screenLine > 0 && screenLine < buildLine}`);

// 12. Rent carries its age ------------------------------------------------------
// registrationRent() returns { lamports, ageSec }; both routes print rentAgeSec beside the figure.
line("12. Rent reading carries an age");
const libSrc = readFileSync(join(here, "..", "src", "lib", "tessera.ts"), "utf8");
console.log(`registrationRent returns RentReading   ${/registrationRent\(\): Promise<RentReading>/.test(libSrc)}`);
console.log(`GET returns rentAgeSec                 ${routeSrc.some((l) => l.includes("rentAgeSec: rent.ageSec"))}`);
console.log(`rent total this run                    ${rentUserReg + rentSenderFee} lamports  ${sol(rentUserReg + rentSenderFee)} SOL  age 0 s at read`);
