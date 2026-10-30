// Usage: npx tsx scripts/probe-seed.ts <slug> <origin-or-"name=url">...
// Probes OAuth discovery documents (no credentials) and records the results in guides/<slug>.json.
// An origin gets the two standard well-known paths; "Name=https://full/url" probes exactly that URL.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { probeOrigins, probeUrl } from "../src/lib/probes";
import { Guide } from "../src/lib/schema";

async function main() {
  const [slug, ...targets] = process.argv.slice(2);
  if (!slug || targets.length === 0) {
    console.error("usage: probe-seed <slug> <origin|name=url>...");
    process.exit(1);
  }
  const file = join("guides", `${slug}.json`);
  const guide = Guide.parse(JSON.parse(readFileSync(file, "utf8")));
  const probes = [];
  for (const t of targets) {
    if (t.includes("=")) {
      const i = t.indexOf("=");
      probes.push(await probeUrl(t.slice(0, i), t.slice(i + 1)));
    } else probes.push(...(await probeOrigins([t])));
  }
  guide.probes = probes;
  writeFileSync(file, JSON.stringify(guide, null, 2) + "\n");
  for (const p of probes) console.log(`${p.ok ? "FOUND " : "absent"}  ${p.url}\n        ${p.finding.slice(0, 160)}`);
}
main();
