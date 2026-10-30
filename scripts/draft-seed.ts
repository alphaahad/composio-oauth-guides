// Usage: npx tsx scripts/draft-seed.ts <slug> "<App Name>" <website> <official-url> [official-url...]
// Runs the real pipeline on hand-picked OFFICIAL pages and saves the result to guides/<slug>.json as a seed draft.
// Review the draft against its sources before keeping it; then run scripts/verify-seeds.ts.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { geminiLlm, type Llm } from "../src/lib/llm";
import { defaultDeps, runPipeline } from "../src/lib/pipeline";
import type { Guide } from "../src/lib/schema";

async function main() {
  process.loadEnvFile(".env.local");
  const [slug, name, website, ...urls] = process.argv.slice(2);
  if (!slug || !name || !website || urls.length === 0) {
    console.error('usage: draft-seed <slug> "<App Name>" <website> <official-url...>');
    process.exit(1);
  }
  const base = geminiLlm(process.env.GEMINI_API_KEY!);
  // The caller vouches that these pages are official, so skip discovery and classification.
  const llm: Llm = {
    ...base,
    discover: async () => ({ website, urls: urls.map((url) => ({ url })) }),
    classify: async (_app, offered) => new Set(offered.map((o) => o.url)),
  };

  let guide: Guide | undefined;
  for await (const ev of runPipeline(name, defaultDeps(llm))) {
    if (ev.type === "stage") console.log(`  [${ev.stage}/${ev.status}] ${ev.message}`);
    if (ev.type === "error") throw new Error(ev.message);
    if (ev.type === "result") guide = ev.guide;
  }
  if (!guide) throw new Error("no guide produced");
  guide = { ...guide, slug, origin: "seed", website, humanReviewed: false };
  writeFileSync(join("guides", `${slug}.json`), JSON.stringify(guide, null, 2) + "\n");

  const secs = [guide.steps, guide.redirectRules, guide.requirements, guide.gotchas, guide.scopeTiers];
  const n = secs.reduce((a, l) => a + l.length, 0);
  const ok = secs.reduce((a, l) => a + l.filter((c) => c.confidence === "docs" || c.confidence === "reported").length, 0);
  console.log(`\nwrote guides/${slug}.json | verdict=${guide.verdict.value} (${guide.verdict.claim.confidence}) | claims ${ok}/${n} supported | pages ${guide.sources.filter((s) => s.status === "ok").length}`);
}
main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
