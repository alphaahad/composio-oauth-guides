// Usage: npx tsx scripts/judge-seeds.ts [slug...]
// Second review of curated guides: asks the entailment judge whether each quote really supports its claim.
// Read-only: it reports problems and does not modify any file.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { geminiLlm } from "../src/lib/llm";
import { judgeGuide } from "../src/lib/pipeline";
import { Guide, type Claim } from "../src/lib/schema";

async function main() {
  process.loadEnvFile(".env.local");
  const llm = geminiLlm(process.env.GEMINI_API_KEY!);
  const only = process.argv.slice(2);
  const files = readdirSync("guides").filter((f) => f.endsWith(".json") && (only.length === 0 || only.includes(f.replace(/\.json$/, ""))));
  for (const f of files) {
    const original = Guide.parse(JSON.parse(readFileSync(join("guides", f), "utf8")));
    const before = new Map<string, Claim>();
    const all = (g: Guide) => [g.verdict.claim, g.wait, g.automation.surfaceClaim, ...g.scopeTiers, ...g.steps, ...g.redirectRules, ...g.requirements, ...g.gotchas, ...g.automation.agentCan, ...g.automation.youMust, ...g.blocked.contacts, ...g.blocked.usualRejections].filter((c): c is Claim => !!c);
    const guide = Guide.parse(JSON.parse(JSON.stringify(original)));
    all(original).forEach((c, i) => before.set(String(i), c));
    const r = await judgeGuide(guide, llm.judge!.bind(llm));
    console.log(`\n${original.slug}: checked ${r.checked}, not supported ${r.unsupported}, partly supported ${r.partial}`);
    all(guide).forEach((c, i) => {
      const was = all(original)[i];
      if (c.confidence !== was.confidence) console.log(`  NOT SUPPORTED: ${was.text.slice(0, 110)}\n      quote: ${was.evidence[0]?.quote.slice(0, 140)}`);
      else if (c.support === "partial") console.log(`  PARTIAL: ${c.text.slice(0, 110)}\n      quote: ${c.evidence[0]?.quote.slice(0, 140)}`);
    });
  }
}
main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
