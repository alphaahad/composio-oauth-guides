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

const BaselineClaim = z.object({ claim: z.string(), verdict: z.enum(["supported", "partial", "contradicted", "not_addressed"]), quote: z.string(), url: z.string() });
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
  const [audit, baseline, corrections] = await Promise.all([
    read("audit.json", Audit, { generatedAt: "", guides: [] } as Audit),
    read("baseline.json", Baseline, [] as Baseline),
    read("corrections.json", Corrections, [] as Corrections),
  ]);
  return { audit, baseline, corrections };
}
