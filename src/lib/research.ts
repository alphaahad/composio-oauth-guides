import { promises as fs } from "node:fs";
import path from "node:path";
import { cacheLife } from "next/cache";
import { z } from "zod";

const dir = path.join(process.cwd(), "research");

const Audit = z.object({
  generatedAt: z.string(),
  guides: z.array(
    z.object({
      slug: z.string(),
      appName: z.string(),
      claims: z.number(),
      byConfidence: z.record(z.string(), z.number()),
      evidenceItems: z.number(),
      quotesFoundOnPage: z.number(),
      judge: z.object({ checked: z.number(), notSupported: z.number(), partlySupported: z.number() }),
      gaps: z.number(),
    }),
  ),
});

const BaselineClaim = z.object({ claim: z.string(), verdict: z.enum(["supported", "partial", "contradicted", "not_addressed"]), quote: z.string(), url: z.string(), handReviewed: z.boolean().optional(), note: z.string().optional() });
const Overrides = z.array(z.object({ slug: z.string(), claimStartsWith: z.string(), verdict: z.enum(["supported", "partial", "contradicted"]), quote: z.string(), url: z.string(), note: z.string() }));
const Baseline = z.array(
  z.object({
    slug: z.string(),
    appName: z.string(),
    generatedAt: z.string(),
    pagesChecked: z.array(z.string()),
    baseline: z.object({ claims: z.array(BaselineClaim), supported: z.number(), partial: z.number(), contradicted: z.number(), notAddressed: z.number() }),
    pipeline: z.object({ claims: z.number(), withQuote: z.number(), gapsListed: z.number() }),
  }),
);

const Corrections = z.array(
  z.object({
    id: z.string(),
    area: z.string(),
    app: z.string(),
    claim: z.string(),
    origin: z.string(),
    outcome: z.enum(["confirmed", "corrected", "conflicting", "unverifiable"]),
    what: z.string(),
    quote: z.string(),
    url: z.string(),
  }),
);

export type Audit = z.infer<typeof Audit>;
export type Baseline = z.infer<typeof Baseline>;
export type Corrections = z.infer<typeof Corrections>;

async function read<T>(file: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  try {
    return schema.parse(JSON.parse(await fs.readFile(path.join(dir, file), "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e; // malformed research data should fail loudly, not render a misleading page
  }
}

/** Research snapshots only change on deploy, so they are cached. */
export async function loadResearch() {
  "use cache";
  cacheLife("max");
  const [audit, rawBaseline, corrections, overrides] = await Promise.all([
    read("audit.json", Audit, { generatedAt: "", guides: [] } as Audit),
    read("baseline.json", Baseline, [] as Baseline),
    read("corrections.json", Corrections, [] as Corrections),
    read("baseline-overrides.json", Overrides, [] as z.infer<typeof Overrides>),
  ]);
  return { audit, baseline: applyOverrides(rawBaseline, overrides), corrections };
}

/**
 * The automated checker misses some claims that our verified sources clearly address. A person read the unconfirmed
 * claims and recorded those as overrides, each with a quote that scripts/verify-research.ts re-checks. They are
 * applied on top of the machine output and marked, never edited into it.
 */
export function applyOverrides(baseline: Baseline, overrides: z.infer<typeof Overrides>): Baseline {
  return baseline.map((app) => {
    const mine = overrides.filter((o) => o.slug === app.slug);
    const claims = app.baseline.claims.map((c) => {
      const o = mine.find((x) => c.claim.startsWith(x.claimStartsWith));
      return o ? { ...c, verdict: o.verdict, quote: o.quote, url: o.url, handReviewed: true, note: o.note } : c;
    });
    const n = (v: string) => claims.filter((c) => c.verdict === v).length;
    return { ...app, baseline: { claims, supported: n("supported"), partial: n("partial"), contradicted: n("contradicted"), notAddressed: n("not_addressed") } };
  });
}
