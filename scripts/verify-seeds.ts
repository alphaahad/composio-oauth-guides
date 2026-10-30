// Usage: npx tsx scripts/verify-seeds.ts [slug...]
// Re-fetches every page cited by the curated guides and checks each quote verbatim.
// Evidence whose url is a repo path (e.g. "evidence/...") is treated as a tested artifact: the file must exist.
// Exits 1 if any quote cannot be found, so stale or wrong claims fail loudly.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchPage } from "../src/lib/fetcher";
import { Guide, type Claim, type Evidence } from "../src/lib/schema";
import { quoteInText } from "../src/lib/verify";

const root = join(__dirname, "..");

function claimsOf(g: Guide): Claim[] {
  return [
    g.verdict.claim, g.effort, g.wait, g.blockerRisk.claim,
    ...g.scopeTiers, ...g.steps, ...g.redirectRules, ...g.requirements, ...g.gotchas,
    ...g.automation.agentCan, ...g.automation.youMust, ...g.blocked.contacts, ...g.blocked.usualRejections,
  ];
}

async function main() {
  const only = process.argv.slice(2);
  const files = readdirSync(join(root, "guides")).filter((f) => f.endsWith(".json") && (only.length === 0 || only.includes(f.replace(/\.json$/, ""))));
  const pageCache = new Map<string, string | null>();
  let checked = 0;
  const failures: string[] = [];

  for (const f of files) {
    const g = Guide.parse(JSON.parse(readFileSync(join(root, "guides", f), "utf8")));
    const evidence: { claim: Claim; e: Evidence }[] = [];
    for (const c of claimsOf(g)) {
      if (c.confidence === "unknown" || c.confidence === "inferred") continue;
      if (c.evidence.length === 0) failures.push(`${g.slug}: "${c.text.slice(0, 60)}" is ${c.confidence} but has no evidence`);
      for (const e of c.evidence) evidence.push({ claim: c, e });
    }
    evidence.push(...g.composio.evidence.map((e) => ({ claim: { text: "composio", confidence: "docs", evidence: [e] } as Claim, e })));

    for (const { claim, e } of evidence) {
      checked++;
      if (!/^https?:/.test(e.url)) {
        if (!existsSync(join(root, e.url))) failures.push(`${g.slug}: tested evidence file missing: ${e.url}`);
        continue;
      }
      if (!pageCache.has(e.url)) {
        const r = await fetchPage(e.url);
        pageCache.set(e.url, r.ok ? r.page.text : null);
        if (!r.ok) console.log(`  could not fetch ${e.url}: ${r.error}`);
      }
      const text = pageCache.get(e.url);
      if (text === null) failures.push(`${g.slug}: could not fetch ${e.url}`);
      else if (!quoteInText(e.quote, text!)) failures.push(`${g.slug}: QUOTE NOT FOUND on ${e.url}\n    claim: ${claim.text.slice(0, 80)}\n    quote: ${e.quote}`);
    }
    console.log(`${g.slug}: ${evidence.length} evidence items`);
  }
  console.log(`\nChecked ${checked} evidence items across ${files.length} guide(s).`);
  if (failures.length) {
    console.log(`\n${failures.length} FAILURE(S):\n` + failures.map((x) => " - " + x).join("\n"));
    process.exit(1);
  }
  console.log("All quotes verified.");
}
main();
