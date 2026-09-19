"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// Operator page: create Par's Tessera referral code from the fee wallet. One signature, once.
export default function SetupPage() {
  const { publicKey, signTransaction, connected } = useWallet();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  async function create() {
    if (!publicKey || !signTransaction) return;
    setStatus("Building create_referral_code.");
    try {
      const res = await fetch("/api/tessera/create-code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: publicKey.toBase58(), code }) });
      const built = await res.json();
      if (!res.ok) throw new Error(built.error ?? res.statusText);
      const tx = VersionedTransaction.deserialize(b64ToBytes(built.transactionBase64));
      const signed = await signTransaction(tx);
      setStatus("Sending.");
      const sent = await fetch("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedTransactionBase64: bytesToB64(signed.serialize()), blockhash: built.blockhash, lastValidBlockHeight: built.lastValidBlockHeight }) });
      const r = await sent.json();
      if (!sent.ok) throw new Error(r.error ?? sent.statusText);
      setStatus(`Code ${built.code} created. Signature ${r.signature}. Set TESSERA_REFERRAL_CODE=${built.code} in the environment.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main>
      <h1>Setup</h1>
      <p className="muted">Operator page. Creates Par&apos;s Tessera referral code from the fee wallet; costs about 0.0023 SOL of rent. The connected wallet must be the fee wallet.</p>
      <div className="controls">
        <WalletMultiButton />
        <input aria-label="Referral code" placeholder="6 to 12 letters or digits" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ width: "14em" }} />
        <button onClick={create} disabled={!connected || !/^[A-Z0-9]{6,12}$/.test(code)}>Create code</button>
      </div>
      {status ? <p className="small mono">{status}</p> : null}
      {publicKey ? <p className="small muted mono">{publicKey.toBase58()}</p> : null}
    </main>
  );
}
