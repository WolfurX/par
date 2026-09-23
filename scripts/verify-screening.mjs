// Verify src/lib/screening.ts against a live OFAC SDN refresh and the live screening APIs.
// Run from the repo root: node --env-file=.env.local scripts/verify-screening.mjs

import { refreshSdn } from "./sdn-refresh.mjs";
import { screenAddress, getSdnInfo } from "../src/lib/screening.ts";

// screening.ts is imported statically above, which runs its module-init load before
// refreshSdn() below ever executes -- so this script proves screenAddress actually uses
// the snapshot this run just fetched (not whatever was already on disk beforehand) by
// checking getSdnInfo().generatedAt against the refresh's own generatedAt after the
// screening loop, instead of just trusting that the blocked/not-blocked calls came out
// right. screening.ts reloads its SDN set by comparing the file's mtime on every call
// (ensureFreshSdn), so this is a real check of the reload path, not a restated assumption.

console.log("Refreshing src/lib/data/sdn-solana.json from OFAC (streams ~127 MB XML)...\n");
const sdn = await refreshSdn();

console.log(`generatedAt:        ${new Date(sdn.generatedAt * 1000).toISOString()}`);
console.log(`total addresses:    ${sdn.count} (check against the "Feature" count for FeatureTypeGroupID`);
console.log(`                    "Digital Currency Address - *" in SDN_ADVANCED.XML)`);
console.log(`Solana count:       ${sdn.sol.length}`);
console.log(`Solana addresses:`);
for (const a of sdn.sol) console.log(`  ${a}`);
console.log(
  `\nCross-check at https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN_ADVANCED.XML\n`,
);

const cases = [
  ...sdn.sol.map((address) => ({ address, expect: true, label: "SDN Solana address" })),
  { address: "9HgFCQ5Wyn3GcFgsx41F1MXJUbmq1Yf3NwEFk5zUg6Kf", expect: false, label: "control (not sanctioned)" },
];

let failures = 0;
for (const c of cases) {
  const result = await screenAddress(c.address);
  const ok = result.blocked === c.expect;
  if (!ok) failures++;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${c.address}  ${c.label}\n` +
      `     expect blocked=${c.expect}  got blocked=${result.blocked}` +
      `  reason=${result.reason ?? "-"}  sources=[${result.sources.join(", ")}]`,
  );
}

console.log(`\n${cases.length - failures}/${cases.length} cases matched expectation.`);

const info = getSdnInfo();
console.log(
  `\nscreening.ts loaded snapshot: generatedAt=${new Date(info.generatedAt * 1000).toISOString()}` +
    ` count=${info.count} ageSec=${info.ageSec}`,
);
if (info.generatedAt !== sdn.generatedAt) {
  console.log(
    `FAIL: screening.ts's loaded snapshot (generatedAt=${info.generatedAt}) does not match the refresh` +
      ` this run just wrote (generatedAt=${sdn.generatedAt}) -- reload did not pick up the fresh data.`,
  );
  failures++;
} else {
  console.log("OK: screening.ts's loaded snapshot matches the refresh this run just wrote.");
}

if (failures > 0) process.exitCode = 1;
