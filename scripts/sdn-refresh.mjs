// Refreshes src/lib/data/sdn-solana.json from OFAC's SDN Advanced XML
// (https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN_ADVANCED.XML, about 127 MB).
// Streams the file line by line and extracts every "Digital Currency Address - <chain>"
// feature; the raw XML is never written to disk. The legacy sdn.csv truncates the SOL
// list, so this reads the advanced XML instead.
// Run from the repo root: node --env-file=.env.local scripts/sdn-refresh.mjs

import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SDN_URL =
  "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN_ADVANCED.XML";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "src", "lib", "data", "sdn-solana.json");

// The Advanced XML defines FeatureType id -> name in a ReferenceValueSets block that
// precedes every DistinctParties entry, so a single forward streaming pass is enough:
// by the time a Feature referencing an id shows up, that id is already in the map.
const FEATURE_TYPE_RE =
  /<FeatureType ID="(\d+)" FeatureTypeGroupID="\d+">Digital Currency Address - ([A-Za-z0-9]+)<\/FeatureType>/;
const FEATURE_OPEN_RE = /<Feature ID="\d+" FeatureTypeID="(\d+)">/;
const VERSION_DETAIL_RE = /<VersionDetail DetailTypeID="1432">([^<]+)<\/VersionDetail>/;

function unescapeXml(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export async function refreshSdn() {
  const res = await fetch(SDN_URL);
  if (!res.ok || !res.body) {
    throw new Error(`SDN_ADVANCED.XML fetch failed: HTTP ${res.status}`);
  }

  const rl = createInterface({ input: Readable.fromWeb(res.body), crlfDelay: Infinity });

  const featureTypeToChain = new Map(); // featureTypeId -> chain code, e.g. "1167" -> "SOL"
  const all = {}; // chain -> address[]
  let currentChain = null; // chain for the <Feature> block currently open, if any

  for await (const line of rl) {
    const ft = FEATURE_TYPE_RE.exec(line);
    if (ft) {
      featureTypeToChain.set(ft[1], ft[2]);
      continue;
    }

    const open = FEATURE_OPEN_RE.exec(line);
    if (open) {
      currentChain = featureTypeToChain.get(open[1]) ?? null;
      continue;
    }

    if (currentChain) {
      const vd = VERSION_DETAIL_RE.exec(line);
      if (vd) {
        (all[currentChain] ??= []).push(unescapeXml(vd[1]));
        continue;
      }
      if (line.includes("</Feature>")) {
        currentChain = null;
      }
    }
  }

  const sol = all.SOL ?? [];
  const count = Object.values(all).reduce((n, arr) => n + arr.length, 0);
  const data = {
    generatedAt: Math.floor(Date.now() / 1000),
    count,
    sol,
    all,
  };

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(data, null, 2) + "\n");
  return data;
}

// Run directly; skip when imported (e.g. by verify-screening.mjs).
if (import.meta.url === `file://${process.argv[1]}`) {
  const data = await refreshSdn();
  console.log(
    `SDN refresh: ${data.count} digital-currency addresses across ${Object.keys(data.all).length} chains.`,
  );
  console.log(`SOL (${data.sol.length}): ${data.sol.join(", ")}`);
  console.log(`Written to ${OUT_PATH}`);
}
