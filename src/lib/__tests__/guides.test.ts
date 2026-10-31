import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { guideToMarkdown, VERDICT_HEADLINE, VERDICT_LABEL, VERDICT_TONE } from "../present";
import { Guide, type Claim } from "../schema";

// Every shipped guide and research file is checked here, so a data fault fails the build instead of reaching a reader.
const root = process.cwd();
const guideFiles = readdirSync(join(root, "guides")).filter((f) => f.endsWith(".json")).sort();
const load = (f: string) => JSON.parse(readFileSync(join(root, "guides", f), "utf8"));

function claimsOf(g: Guide): Claim[] {
  return [g.verdict.claim, g.effort, g.wait, g.automation.surfaceClaim, ...g.scopeTiers, ...g.steps, ...g.redirectRules, ...g.requirements, ...g.gotchas, ...g.automation.agentCan, ...g.automation.youMust, ...g.blocked.contacts, ...g.blocked.usualRejections].filter(
    (c): c is Claim => !!c,
  );
}

describe("shipped guides", () => {
  it("there are guides to check", () => {
    expect(guideFiles.length).toBeGreaterThanOrEqual(6);
  });

  describe.each(guideFiles)("%s", (file) => {
    const raw = load(file);
    const parsed = Guide.safeParse(raw);

    it("matches the schema", () => {
      expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
    });

    if (!parsed.success) return;
    const g = parsed.data;

    it("has a slug that matches its filename and is URL-safe", () => {
      expect(g.slug).toBe(file.replace(/\.json$/, ""));
      expect(g.slug).toMatch(/^[a-z0-9][a-z0-9-]{0,59}$/);
      expect(g.origin).toBe("seed");
    });

    it("has valid dates and lists its gaps", () => {
      expect(Number.isNaN(Date.parse(g.generatedAt))).toBe(false);
      for (const s of g.sources) expect(Number.isNaN(Date.parse(s.fetchedAt))).toBe(false);
      expect(g.gaps.length).toBeGreaterThan(0);
    });

    it("every confident claim carries evidence that is a real https page or one of our own test logs", () => {
      for (const c of claimsOf(g)) {
        if (["docs", "tested", "reported", "conflicting"].includes(c.confidence)) expect(c.evidence.length, `"${c.text}" has no evidence`).toBeGreaterThan(0);
        for (const e of c.evidence) {
          expect(e.url.startsWith("https://") || e.url.startsWith("/evidence/"), e.url).toBe(true);
          expect(e.quote.length, `short quote on "${c.text}"`).toBeGreaterThanOrEqual(12);
          if (e.url.startsWith("/evidence/")) expect(existsSync(join(root, "public", e.url)), `missing ${e.url}`).toBe(true);
        }
        if (c.confidence === "tested") expect(c.evidence.some((e) => e.url.startsWith("/evidence/")), `tested claim without a test log: ${c.text}`).toBe(true);
        expect(c.text.trim() !== "" || c.confidence === "unknown").toBe(true);
        expect(c.text).not.toMatch(/undefined|NaN|\[object|TODO|FIXME|lorem ipsum/i);
      }
    });

    it("never presents an unknown verdict as confident", () => {
      if (g.verdict.value === "unknown") expect(g.verdict.claim.confidence).toBe("unknown");
      expect(VERDICT_HEADLINE[g.verdict.value]).toBeTruthy();
      expect(VERDICT_LABEL[g.verdict.value]).toBeTruthy();
      expect(VERDICT_TONE[g.verdict.value]).toBeTruthy();
    });

    it("only cites https sources", () => {
      for (const s of g.sources) expect(s.url.startsWith("https://")).toBe(true);
    });

    it("exports clean Markdown", () => {
      const md = guideToMarkdown(g, `https://example.test/g/${g.slug}`);
      expect(md.startsWith(`# ${g.appName}: OAuth app setup`)).toBe(true);
      expect(md).toContain("## Verdict");
      expect(md).toContain("## At a glance");
      expect(md).toContain("## What we could not verify");
      expect(md).not.toMatch(/undefined|NaN|\[object Object\]|\n- \n/);
      expect(md.endsWith("\n")).toBe(true);
    });
  });

  it("slugs are unique", () => {
    expect(new Set(guideFiles).size).toBe(guideFiles.length);
  });
});

describe("research files", () => {
  const read = (f: string) => JSON.parse(readFileSync(join(root, "research", f), "utf8"));

  it("corrections have unique ids, valid outcomes, and a quote only when they cite a url", () => {
    const rows = read("corrections.json") as { id: string; outcome: string; quote: string; url: string; what: string }[];
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    for (const r of rows) {
      expect(["confirmed", "corrected", "conflicting", "unverifiable"]).toContain(r.outcome);
      expect(r.what.length).toBeGreaterThan(20);
      expect(Boolean(r.quote)).toBe(Boolean(r.url));
      if (r.url.startsWith("/evidence/")) expect(existsSync(join(root, "public", r.url))).toBe(true);
    }
  });

  it("every baseline override matches exactly one claim in the baseline", () => {
    const overrides = read("baseline-overrides.json") as { slug: string; claimStartsWith: string }[];
    const baseline = read("baseline.json") as { slug: string; baseline: { claims: { claim: string }[] } }[];
    for (const o of overrides) {
      const app = baseline.find((b) => b.slug === o.slug);
      expect(app, o.slug).toBeTruthy();
      expect(app!.baseline.claims.filter((c) => c.claim.startsWith(o.claimStartsWith)).length, o.claimStartsWith).toBe(1);
    }
  });

  it("every curated guide has a baseline and an audit row", () => {
    const baseline = new Set((read("baseline.json") as { slug: string }[]).map((b) => b.slug));
    const audit = new Set((read("audit.json") as { guides: { slug: string }[] }).guides.map((g) => g.slug));
    for (const f of guideFiles) {
      const slug = f.replace(/\.json$/, "");
      expect(baseline.has(slug), `no baseline for ${slug}`).toBe(true);
      expect(audit.has(slug), `no audit row for ${slug}`).toBe(true);
    }
  });
});
