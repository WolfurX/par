import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { USDC_MINT, wrappers } from "@/lib/registry";

export const dynamic = "force-dynamic";

// On-chain ledger of the fee account: USDC received, plus Tessera referral payouts (T-Tokens from the fee manager).
const TESSERA_FEE_MANAGER = "FV7A7uLK5jznMSZTbQAWyUFNdM15m4RnbKePUz5rrCeE";
const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
// The fee wallet had a life before Par; only count inflows from launch onwards.
const LEDGER_SINCE = Number(process.env.LEDGER_SINCE ?? 1789776000); // 2026-09-19T00:00:00Z

interface Entry { signature: string; time: number; kind: "fee" | "referral" | "other"; amount: number; symbol: string; from?: string }

let cache: { at: number; value: unknown } | null = null;

async function rpc(method: string, params: unknown[]) {
  const url = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

export async function GET() {
  if (cache && Date.now() - cache.at < 60_000) return NextResponse.json(cache.value);
  const owner = new PublicKey(process.env.FEE_WALLET ?? "");
  const usdcAta = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), owner, false);
  const tMints = wrappers.filter((w) => w.issuer === "tessera");
  const tAtas = tMints.map((w) => ({ w, ata: getAssociatedTokenAddressSync(new PublicKey(w.mint), owner, false, new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")) }));

  const entries: Entry[] = [];
  const accounts = [{ ata: usdcAta, symbol: "USDC", decimals: 6, kind: "fee" as const }, ...tAtas.map((t) => ({ ata: t.ata, symbol: t.w.symbol, decimals: t.w.decimals, kind: "referral" as const }))];
  for (const acc of accounts) {
    let sigs: { signature: string; blockTime?: number; err: unknown }[] = [];
    try {
      sigs = await rpc("getSignaturesForAddress", [acc.ata.toBase58(), { limit: 50 }]);
    } catch {
      continue;
    }
    for (const s of sigs.filter((x) => !x.err).slice(0, 25)) {
      try {
        const tx = await rpc("getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
        const pre = (tx?.meta?.preTokenBalances ?? []) as { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } }[];
        const post = (tx?.meta?.postTokenBalances ?? []) as typeof pre;
        const keys = (tx?.transaction?.message?.accountKeys ?? []) as { pubkey: string }[];
        const idx = keys.findIndex((k) => k.pubkey === acc.ata.toBase58());
        if (idx < 0) continue;
        const before = Number(pre.find((b) => b.accountIndex === idx)?.uiTokenAmount.amount ?? 0);
        const after = Number(post.find((b) => b.accountIndex === idx)?.uiTokenAmount.amount ?? 0);
        const delta = (after - before) / 10 ** acc.decimals;
        if (delta <= 0) continue;
        const signer = keys[0]?.pubkey;
        const viaJupiter = keys.some((k) => k.pubkey === JUPITER_V6);
        const fromSelf = signer === owner.toBase58();
        // A swap fee is USDC arriving through a Jupiter route signed by someone else; anything else is a plain transfer in.
        const kind: Entry["kind"] = acc.kind === "referral" ? (signer === TESSERA_FEE_MANAGER ? "referral" : "other") : viaJupiter && !fromSelf ? "fee" : "other";
        if ((s.blockTime ?? 0) < LEDGER_SINCE) continue;
        entries.push({ signature: s.signature, time: s.blockTime ?? 0, kind, amount: delta, symbol: acc.symbol, from: signer });
      } catch {
        // skip unreadable transactions
      }
    }
  }
  entries.sort((a, b) => b.time - a.time);
  const totals: Record<string, number> = {};
  for (const e of entries) if (e.kind !== "other") totals[e.symbol] = (totals[e.symbol] ?? 0) + e.amount;
  const value = { feeWallet: owner.toBase58(), usdcFeeAccount: usdcAta.toBase58(), tesseraAccounts: tAtas.map((t) => ({ symbol: t.w.symbol, ata: t.ata.toBase58() })), totals, entries, generatedAt: Math.floor(Date.now() / 1000) };
  cache = { at: Date.now(), value };
  return NextResponse.json(value);
}
