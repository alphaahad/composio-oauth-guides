import { z } from "zod";

/**
 * How much we trust a claim. Assigned by our code, never by the model.
 * - tested:      we ran it ourselves and saved evidence
 * - docs:        a verbatim quote was found on a fetched official page
 * - reported:    community/anecdotal source, not official
 * - inferred:    our estimate derived from other fields (e.g. effort from step count)
 * - conflicting: sources disagree
 * - unknown:     nothing supports it; shown as a gap, not hidden
 */
export const Confidence = z.enum([
  "tested",
  "docs",
  "reported",
  "inferred",
  "conflicting",
  "unknown",
]);
export type Confidence = z.infer<typeof Confidence>;

export const Evidence = z.object({
  url: z.string(),
  quote: z.string(),
  fetchedAt: z.string(),
});
export type Evidence = z.infer<typeof Evidence>;

export const Claim = z.object({
  text: z.string(),
  confidence: Confidence,
  evidence: z.array(Evidence),
});
export type Claim = z.infer<typeof Claim>;

export const Verdict = z.enum([
  "no-approval-needed", // register and go
  "self-serve-with-review-for-listing", // works immediately, review only to be listed/public
  "review-required", // must pass provider review before real users can connect
  "partner-gated", // access limited to approved partners/programs
  "no-oauth", // app does not offer OAuth (API key etc.)
  "unknown",
]);
export type Verdict = z.infer<typeof Verdict>;

export const Risk = z.enum(["low", "medium", "high", "unknown"]);

export const Surface = z.enum([
  "api", // fully creatable via API
  "cli",
  "manifest", // manifest/config-driven but a human step remains
  "ui-only",
  "gated", // human/provider gate (review, verification)
  "unknown",
]);

export const ProbeResult = z.object({
  name: z.string(),
  url: z.string(),
  ok: z.boolean(),
  status: z.number().optional(),
  finding: z.string(),
  probedAt: z.string(),
});
export type ProbeResult = z.infer<typeof ProbeResult>;

export const SourceRef = z.object({
  url: z.string(),
  title: z.string().optional(),
  fetchedAt: z.string(),
  status: z.enum(["ok", "failed", "empty"]),
  note: z.string().optional(),
});
export type SourceRef = z.infer<typeof SourceRef>;

export const Guide = z.object({
  slug: z.string(),
  appName: z.string(),
  website: z.string().optional(),
  origin: z.enum(["seed", "live"]),
  humanReviewed: z.boolean(),
  generatedAt: z.string(),

  usesOAuth: z.enum(["yes", "no", "unclear"]),
  verdict: z.object({ value: Verdict, claim: Claim }),
  summary: z.string(),

  composio: z.object({
    managed: z.enum(["yes", "no", "unknown"]),
    note: z.string(),
    evidence: z.array(Evidence),
  }),

  effort: Claim, // dev hours, usually inferred
  wait: Claim, // calendar time for approval, often unknown
  blockerRisk: z.object({ value: Risk, claim: Claim }),

  scopeTiers: z.array(Claim),
  steps: z.array(Claim),
  redirectRules: z.array(Claim),
  requirements: z.array(Claim),
  gotchas: z.array(Claim),

  automation: z.object({
    surface: Surface,
    agentCan: z.array(Claim),
    youMust: z.array(Claim),
  }),

  blocked: z.object({
    contacts: z.array(Claim),
    usualRejections: z.array(Claim),
    emailTemplate: z.string().optional(),
  }),

  probes: z.array(ProbeResult),
  sources: z.array(SourceRef),
  gaps: z.array(z.string()),
});
export type Guide = z.infer<typeof Guide>;

/* ------------------------------------------------------------------ */
/* What the LLM returns. Plain strings only (no unions/nulls) so it is  */
/* robust under structured output. "" means "no source / not stated".   */
/* ------------------------------------------------------------------ */

export const ExtractedItem = z.object({
  text: z.string().describe("One concise statement a developer can act on."),
  sourceUrl: z
    .string()
    .describe("URL of the fetched page the quote comes from, or empty."),
  quote: z
    .string()
    .describe(
      "A VERBATIM excerpt (12-300 chars) copied exactly from that page that supports the text. Empty if the page does not say it. Never paraphrase.",
    ),
});
export type ExtractedItem = z.infer<typeof ExtractedItem>;

export const ExtractedGuide = z.object({
  appName: z.string(),
  usesOAuth: z.enum(["yes", "no", "unclear"]),
  verdict: Verdict,
  verdictItem: ExtractedItem.describe(
    "Why this verdict. Quote the page that gates (or doesn't gate) access.",
  ),
  summary: z
    .string()
    .describe("2-3 plain sentences: what a developer must do and what could block them."),
  effortHours: z.object({
    minHours: z.number(),
    maxHours: z.number(),
    basis: z.string().describe("How you estimated this from the steps."),
  }),
  waitItem: ExtractedItem.describe(
    "Approval wait. text must be exactly 'not stated' with empty quote if no page states a timeline.",
  ),
  blockerRisk: Risk,
  scopeTiers: z.array(ExtractedItem),
  steps: z.array(ExtractedItem),
  redirectRules: z.array(ExtractedItem),
  requirements: z.array(ExtractedItem),
  gotchas: z.array(ExtractedItem),
  surface: Surface,
  agentCan: z.array(ExtractedItem),
  youMust: z.array(ExtractedItem),
  contacts: z.array(ExtractedItem),
  usualRejections: z.array(ExtractedItem),
  emailTemplate: z
    .string()
    .describe("Short template for contacting the provider if blocked, or empty."),
  gaps: z.array(z.string()).describe("Things the pages did not answer."),
});
export type ExtractedGuide = z.infer<typeof ExtractedGuide>;
