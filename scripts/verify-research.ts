// Usage: npx tsx scripts/verify-research.ts
// Checks that every quote in research/baseline-overrides.json and research/corrections.json is really on its page
// (or in our own evidence log), and that each override matches a claim in research/baseline.json.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchPage } from "../src/lib/fetcher";
import { quoteInText } from "../src/lib/verify";

type Item = { quote: string; url: string; label: string };

async function main() {
  const overrides = JSON.parse(readFileSync("research/baseline-overrides.json", "utf8")) as { slug: string; claimStartsWith: string; quote: string; url: string }[];
  const corrections = JSON.parse(readFileSync("research/corrections.json", "utf8")) as { id: string; quote: string; url: string }[];
  const baseline = JSON.parse(readFileSync("research/baseline.json", "utf8")) as { slug: string; baseline: { claims: { claim: string }[] } }[];

  const items: Item[] = [
    ...overrides.map((o) => ({ quote: o.quote, url: o.url, label: `override ${o.slug}: ${o.claimStartsWith.slice(0, 40)}` })),
    ...corrections.filter((c) => c.quote && c.url).map((c) => ({ quote: c.quote, url: c.url, label: `correction ${c.id}` })),
  ];
  const failures: string[] = [];
  for (const o of overrides) {
    const app = baseline.find((b) => b.slug === o.slug);
    if (!app?.baseline.claims.some((c) => c.claim.startsWith(o.claimStartsWith))) failures.push(`override matches no claim: ${o.slug} / ${o.claimStartsWith}`);
  }
  const cache = new Map<string, string | null>();
  for (const it of items) {
    if (!cache.has(it.url)) {
      if (it.url.startsWith("/")) {
        const f = join("public", it.url);
        cache.set(it.url, existsSync(f) ? readFileSync(f, "utf8") : null);
      } else {
        const r = await fetchPage(it.url);
        cache.set(it.url, r.ok ? r.page.text : null);
      }
    }
    const text = cache.get(it.url);
    if (!text) failures.push(`${it.label}: could not read ${it.url}`);
    else if (!quoteInText(it.quote, text)) failures.push(`${it.label}: QUOTE NOT FOUND\n    ${it.quote.slice(0, 120)}`);
  }
  console.log(`Checked ${items.length} quotes and ${overrides.length} overrides.`);
  if (failures.length) {
    console.log("\nFAILURES:\n" + failures.map((f) => " - " + f).join("\n"));
    process.exit(1);
  }
  console.log("All research quotes verified.");
}
main();
