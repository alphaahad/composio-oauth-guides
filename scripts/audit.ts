// Usage: npx tsx scripts/audit.ts
// Snapshot of how every curated claim holds up: (1) quote found on the live page, (2) the support judge's ruling.
// Writes research/audit.json, rendered on /verification. The judge is a model and varies between runs; the snapshot
// records one run with its date. Read-only with respect to guides/.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchPage } from "../src/lib/fetcher";
import { geminiLlm } from "../src/lib/llm";
import { judgeGuide } from "../src/lib/pipeline";
import { Guide, type Claim } from "../src/lib/schema";
import { quoteInText } from "../src/lib/verify";

const claimsOf = (g: Guide): Claim[] =>
  [g.verdict.claim, g.wait, g.automation.surfaceClaim, ...g.scopeTiers, ...g.steps, ...g.redirectRules, ...g.requirements, ...g.gotchas, ...g.automation.agentCan, ...g.automation.youMust, ...g.blocked.contacts, ...g.blocked.usualRejections].filter((c): c is Claim => !!c);

async function main() {
  process.loadEnvFile(".env.local");
  const llm = geminiLlm(process.env.GEMINI_API_KEY!);
  const pageText = new Map<string, string | null>();
  const rows = [];

  for (const f of readdirSync("guides").filter((x) => x.endsWith(".json")).sort()) {
    const g = Guide.parse(JSON.parse(readFileSync(join("guides", f), "utf8")));
    const claims = claimsOf(g);
    let evidence = 0;
    let matched = 0;
    for (const c of claims) {
      if (c.confidence === "unknown" || c.confidence === "inferred") continue;
      for (const e of c.evidence) {
        evidence++;
        if (!pageText.has(e.url)) {
          const r = await fetchPage(e.url);
          pageText.set(e.url, r.ok ? r.page.text : null);
        }
        const t = pageText.get(e.url);
        if (t && quoteInText(e.quote, t)) matched++;
      }
    }
    const copy = Guide.parse(JSON.parse(JSON.stringify(g)));
    const j = await judgeGuide(copy, llm.judge!.bind(llm));
    const by = (c: Guide["verdict"]["claim"]["confidence"]) => claims.filter((x) => x.confidence === c).length;
    rows.push({
      slug: g.slug,
      appName: g.appName,
      claims: claims.length,
      byConfidence: { docs: by("docs"), conflicting: by("conflicting"), inferred: by("inferred"), unknown: by("unknown"), tested: by("tested"), reported: by("reported") },
      evidenceItems: evidence,
      quotesFoundOnPage: matched,
      judge: { checked: j.checked, notSupported: j.unsupported, partlySupported: j.partial },
      gaps: g.gaps.length,
    });
    console.log(`${g.slug.padEnd(9)} ${claims.length} claims | ${matched}/${evidence} quotes found on live pages | judge: ${j.checked - j.unsupported - j.partial} supported, ${j.partial} partial, ${j.unsupported} not supported | ${g.gaps.length} gaps listed`);
  }
  writeFileSync(join("research", "audit.json"), JSON.stringify({ generatedAt: new Date().toISOString(), guides: rows }, null, 2) + "\n");
  console.log("wrote research/audit.json");
}
main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
