import { describe, expect, it } from "vitest";
import { resolveInput, runPipeline, slugify, type Deps, type PipelineEvent } from "../pipeline";
import type { ExtractedGuide } from "../schema";

const DOC_URL = "https://docs.example.com/oauth";
const DOC_TEXT =
  "Register your app in the developer portal. Redirect URLs must use HTTPS. " +
  "Apps listed in the marketplace go through review. ".repeat(6);

const item = (text: string, quote: string, sourceUrl = DOC_URL) => ({ text, quote, sourceUrl });

const extraction = (over: Partial<ExtractedGuide> = {}): ExtractedGuide => ({
  appName: "Example",
  usesOAuth: "yes",
  verdict: "self-serve-with-review-for-listing",
  verdictItem: item("Marketplace listing needs review", "Apps listed in the marketplace go through review."),
  summary: "Register and go; review only for listing.",
  effortHours: { minHours: 1, maxHours: 2, basis: "three short steps" },
  waitItem: { text: "not stated", quote: "", sourceUrl: "" },
  blockerRisk: "low",
  scopeTiers: [],
  steps: [item("Register in the portal", "Register your app in the developer portal."), item("Made-up step", "Click the secret admin button to skip review.")],
  redirectRules: [item("HTTPS only", "Redirect URLs must use HTTPS.")],
  requirements: [],
  gotchas: [],
  surface: "ui-only",
  agentCan: [],
  youMust: [item("Human registers", "Register your app in the developer portal.")],
  contacts: [],
  usualRejections: [],
  emailTemplate: "",
  gaps: ["Pricing not covered"],
  ...over,
});

const mkDeps = (over: Partial<Deps> = {}, ex: ExtractedGuide = extraction()): Deps => ({
  llm: {
    discover: async () => [{ url: DOC_URL, title: "Docs" }],
    classify: async (_a, urls) => new Set(urls.map((u) => u.url)),
    extract: async () => ex,
  },
  fetchPage: async (url) => ({ ok: true, status: 200, page: { url, title: "Docs", text: DOC_TEXT, fetchedAt: "2026-10-30T00:00:00.000Z" } }),
  probe: async () => [],
  composio: async () => ({ managed: "no", note: "bring your own", matches: [], sourceUrl: "https://docs.composio.dev/toolkits/managed-auth", fetchedAt: "2026-10-30T00:00:00.000Z" }),
  ...over,
});

async function run(input: string, deps: Deps) {
  const events: PipelineEvent[] = [];
  for await (const e of runPipeline(input, deps)) events.push(e);
  return events;
}
const resultOf = (events: PipelineEvent[]) => events.find((e) => e.type === "result");

describe("runPipeline", () => {
  it("verifies real quotes, downgrades fabricated ones, never invents a wait time", async () => {
    const events = await run("Example", mkDeps());
    const r = resultOf(events);
    if (r?.type !== "result") throw new Error("no result");
    const g = r.guide;
    expect(g.steps[0].confidence).toBe("docs");
    expect(g.steps[0].evidence[0].url).toBe(DOC_URL);
    expect(g.steps[1].confidence).toBe("unknown");
    expect(g.steps[1].evidence).toEqual([]);
    expect(g.verdict.value).toBe("self-serve-with-review-for-listing");
    expect(g.verdict.claim.confidence).toBe("docs");
    expect(g.wait.confidence).toBe("unknown");
    expect(g.wait.text).toMatch(/not stated/i);
    expect(g.effort.confidence).toBe("inferred");
    expect(g.humanReviewed).toBe(false);
    expect(g.gaps.some((x) => x.startsWith("Verification: 1 of"))).toBe(true);
  });

  it("downgrades an unsupported verdict to unknown", async () => {
    const ex = extraction({ verdict: "partner-gated", verdictItem: item("Gated", "Only approved partners may use this API.") });
    const r = resultOf(await run("Example", mkDeps({}, ex)));
    if (r?.type !== "result") throw new Error("no result");
    expect(r.guide.verdict.value).toBe("unknown");
    expect(r.guide.gaps.some((g) => g.includes("partner-gated"))).toBe(true);
  });

  it("rejects a stated wait whose quote is fabricated", async () => {
    const ex = extraction({ waitItem: item("2 days", "Reviews are completed within two days.") });
    const r = resultOf(await run("Example", mkDeps({}, ex)));
    if (r?.type !== "result") throw new Error("no result");
    expect(r.guide.wait.confidence).toBe("unknown");
  });

  it("labels quotes from community pages as reported", async () => {
    const deps = mkDeps({ llm: { discover: async () => [{ url: DOC_URL }], classify: async () => new Set(), extract: async () => extraction() } });
    const r = resultOf(await run("Example", deps));
    if (r?.type !== "result") throw new Error("no result");
    expect(r.guide.steps[0].confidence).toBe("reported");
  });

  it("returns an honest gaps-only guide when no page can be read", async () => {
    let extractCalled = false;
    const deps = mkDeps({
      fetchPage: async (url) => ({ ok: false, url, error: "HTTP 403" }),
      llm: { discover: async () => [{ url: DOC_URL }], classify: async () => new Set(), extract: async () => ((extractCalled = true), extraction()) },
    });
    const events = await run("Example", deps);
    const r = resultOf(events);
    if (r?.type !== "result") throw new Error("no result");
    expect(extractCalled).toBe(false);
    expect(r.guide.verdict.value).toBe("unknown");
    expect(r.guide.steps).toEqual([]);
    expect(r.guide.sources[0].status).toBe("failed");
  });

  it("survives a failing search by falling back to the website", async () => {
    const deps = mkDeps({ llm: { discover: async () => { throw new Error("quota"); }, classify: async () => new Set(), extract: async () => extraction() } });
    const events = await run("docs.example.com", deps);
    expect(events.some((e) => e.type === "stage" && e.status === "warn" && /Search failed/.test(e.message))).toBe(true);
    expect(resultOf(events)).toBeTruthy();
  });

  it("emits an error event on extraction failure and on bad input", async () => {
    const bad = mkDeps({ llm: { discover: async () => [{ url: DOC_URL }], classify: async () => new Set([DOC_URL]), extract: async () => ({ nope: true }) } });
    expect((await run("Example", bad)).at(-1)?.type).toBe("error");
    expect((await run("   ", mkDeps())).at(-1)?.type).toBe("error");
  });
});

describe("helpers", () => {
  it("resolveInput handles names and URLs", () => {
    expect(resolveInput("Slack")).toEqual({ name: "Slack" });
    expect(resolveInput("https://www.notion.so/product")).toEqual({ name: "Notion", website: "https://www.notion.so" });
    expect(resolveInput("developer.github.com").name).toBe("Github");
    expect(() => resolveInput("x".repeat(101))).toThrow();
  });
  it("slugify", () => {
    expect(slugify("Google Drive!")).toBe("google-drive");
    expect(slugify("???")).toBe("app");
  });
});
