import { describe, expect, it } from "vitest";
import { RateLimitError } from "../llm";
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
  surfaceItem: item("Created through the web UI", "Register your app in the developer portal."),
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
    discover: async () => ({ urls: [{ url: DOC_URL, title: "Docs" }] }),
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

  it("shows the setup surface only when a quote supports it (regression: webhooks must not imply 'creatable via API')", async () => {
    const ex = extraction({
      surface: "api",
      surfaceItem: item("API creation", "Create the app by calling the secret endpoint."),
      agentCan: [item("Webhooks", "Register your app in the developer portal.")],
    });
    const r = resultOf(await run("Example", mkDeps({}, ex)));
    if (r?.type !== "result") throw new Error("no result");
    expect(r.guide.automation.surface).toBe("unknown");
    expect(r.guide.automation.surfaceClaim).toBeUndefined();
  });

  it("keeps a supported surface with its evidence", async () => {
    const r = resultOf(await run("Example", mkDeps()));
    if (r?.type !== "result") throw new Error("no result");
    expect(r.guide.automation.surface).toBe("ui-only");
    expect(r.guide.automation.surfaceClaim?.confidence).toBe("docs");
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
    const deps = mkDeps({ llm: { discover: async () => ({ urls: [{ url: DOC_URL }] }), classify: async () => new Set(), extract: async () => extraction() } });
    const r = resultOf(await run("Example", deps));
    if (r?.type !== "result") throw new Error("no result");
    expect(r.guide.steps[0].confidence).toBe("reported");
  });

  it("returns an honest gaps-only guide when no page can be read", async () => {
    let extractCalled = false;
    const deps = mkDeps({
      fetchPage: async (url) => ({ ok: false, url, error: "HTTP 403" }),
      llm: { discover: async () => ({ urls: [{ url: DOC_URL }] }), classify: async () => new Set(), extract: async () => ((extractCalled = true), extraction()) },
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
    expect(events.some((e) => e.type === "stage" && e.status === "warn" && /unavailable/.test(e.message))).toBe(true);
    expect(resultOf(events)).toBeTruthy();
  });

  it("emits an error event on extraction failure and on bad input", async () => {
    const bad = mkDeps({ llm: { discover: async () => ({ urls: [{ url: DOC_URL }] }), classify: async () => new Set([DOC_URL]), extract: async () => ({ nope: true }) } });
    expect((await run("Example", bad)).at(-1)?.type).toBe("error");
    expect((await run("   ", mkDeps())).at(-1)?.type).toBe("error");
  });
});

describe("discovery without a search tool", () => {
  it("falls back to the website when the model is rate limited, and says so", async () => {
    const deps = mkDeps({ llm: { discover: async () => { throw new RateLimitError(); }, classify: async () => new Set(), extract: async () => extraction() } });
    const events = await run("docs.example.com", deps);
    expect(events.some((e) => e.type === "stage" && e.status === "warn" && /rate limit/.test(e.message))).toBe(true);
    expect(resultOf(events)).toBeTruthy();
  });

  it("shows a friendly message, not raw API text, when extraction hits the rate limit", async () => {
    const deps = mkDeps({ llm: { discover: async () => ({ urls: [{ url: DOC_URL }] }), classify: async () => new Set([DOC_URL]), extract: async () => { throw new RateLimitError(); } } });
    const last = (await run("Example", deps)).at(-1);
    expect(last?.type).toBe("error");
    if (last?.type === "error") expect(last.message).toMatch(/try again in a minute/i);
  });

  it("stays silent about guessed docs addresses that fail, but reports failed model-proposed URLs", async () => {
    const deps = mkDeps({
      fetchPage: async (url) =>
        url === DOC_URL
          ? { ok: true, status: 200, page: { url, title: "Docs", text: DOC_TEXT, fetchedAt: "2026-10-30T00:00:00.000Z" } }
          : { ok: false, url, error: "HTTP 404" },
      llm: { discover: async () => ({ urls: [{ url: DOC_URL }, { url: "https://dead.example.com/x" }] }), classify: async () => new Set([DOC_URL]), extract: async () => extraction() },
    });
    const r = resultOf(await run("example.com", deps));
    if (r?.type !== "result") throw new Error("no result");
    const failed = r.guide.sources.filter((x) => x.status === "failed").map((x) => x.url);
    // the user's own site and the model-proposed URL are reported; guessed addresses (developers.example.com, ...) are not
    expect(failed).toEqual(["https://example.com/", "https://dead.example.com/x"]);
  });

  it("does not treat a website the model proposed as official", async () => {
    const deps = mkDeps({
      llm: {
        discover: async () => ({ website: "https://made-up-site.example", urls: [{ url: "https://made-up-site.example/docs" }] }),
        classify: async () => new Set(), // classifier says nothing is official
        extract: async () => extraction({ steps: [{ text: "s", quote: "Register your app in the developer portal.", sourceUrl: "https://made-up-site.example/docs" }] }),
      },
    });
    const r = resultOf(await run("Obscure", deps));
    if (r?.type !== "result") throw new Error("no result");
    expect(r.guide.steps[0].confidence).toBe("reported");
  });
});

describe("link following", () => {
  const LANDING = "https://docs.example.com/overview";
  const OAUTH = "https://docs.example.com/authentication/oauth-2-0";
  const ok = (url: string, text = DOC_TEXT, links: string[] = []) => ({ ok: true as const, status: 200, page: { url, title: url, text, fetchedAt: "2026-10-30T00:00:00.000Z" }, links });

  it("follows relevant links from an official landing page and cites the deeper page", async () => {
    const deps = mkDeps({
      fetchPage: async (url) => {
        if (url === LANDING) return ok(LANDING, "Welcome to the docs. " .repeat(30), [OAUTH, "https://docs.example.com/blog/news"]);
        if (url === OAUTH) return ok(OAUTH);
        return { ok: false as const, url, error: "HTTP 404" };
      },
      llm: { discover: async () => ({ urls: [{ url: LANDING }] }), classify: async () => new Set([LANDING]), extract: async () => extraction({ steps: [{ text: "Register", quote: "Register your app in the developer portal.", sourceUrl: OAUTH }] }) },
    });
    const events = await run("Example", deps);
    expect(events.some((e) => e.type === "stage" && /Following 1 link/.test(e.message))).toBe(true);
    const r = resultOf(events);
    if (r?.type !== "result") throw new Error("no result");
    expect(r.guide.steps[0].confidence).toBe("docs");
    expect(r.guide.steps[0].evidence[0].url).toBe(OAUTH);
  });

  it("collapses several candidates that redirect to the same page", async () => {
    const deps = mkDeps({
      fetchPage: async () => ok(LANDING),
      llm: { discover: async () => ({ urls: [{ url: "https://a.example.com" }, { url: "https://b.example.com" }, { url: "https://c.example.com" }] }), classify: async () => new Set(["https://a.example.com", "https://b.example.com", "https://c.example.com"]), extract: async () => extraction() },
    });
    const r = resultOf(await run("Example", deps));
    if (r?.type !== "result") throw new Error("no result");
    expect(r.guide.sources.filter((s) => s.status === "ok")).toHaveLength(1);
  });

  it("fetches a linked page once even when it is linked with different query strings", async () => {
    const fetched: string[] = [];
    const deps = mkDeps({
      fetchPage: async (url) => { fetched.push(url); return url === LANDING ? ok(LANDING, "Welcome to the docs. ".repeat(30), [OAUTH + "?a=1", OAUTH + "?a=2", OAUTH]) : ok(url); },
      llm: { discover: async () => ({ urls: [{ url: LANDING }] }), classify: async () => new Set([LANDING]), extract: async () => extraction() },
    });
    await run("Example", deps);
    expect(fetched.filter((u) => u.startsWith(OAUTH))).toHaveLength(1);
  });

  it("does not follow links from pages that are not confirmed official", async () => {
    const fetched: string[] = [];
    const deps = mkDeps({
      fetchPage: async (url) => { fetched.push(url); return url === LANDING ? ok(LANDING, DOC_TEXT, [OAUTH]) : ok(url); },
      llm: { discover: async () => ({ urls: [{ url: LANDING }] }), classify: async () => new Set(), extract: async () => extraction() },
    });
    await run("Example", deps);
    expect(fetched).not.toContain(OAUTH);
  });
});

describe("support (entailment) check", () => {
  const llmWith = (judge: (items: { id: number; claim: string; quote: string }[]) => Promise<Map<number, "supports" | "partial" | "unrelated">>) => ({
    discover: async () => ({ urls: [{ url: DOC_URL }] }),
    classify: async (_a: string, urls: { url: string }[]) => new Set(urls.map((u) => u.url)),
    extract: async () => extraction(),
    judge,
  });
  const byText = (rules: Record<string, "partial" | "unrelated">) => async (items: { id: number; claim: string }[]) =>
    new Map(items.map((i) => [i.id, Object.entries(rules).find(([k]) => i.claim.includes(k))?.[1] ?? ("supports" as const)]));

  it("downgrades a claim whose quote exists but does not support it, and flags partial ones", async () => {
    const deps = mkDeps({ llm: llmWith(byText({ "Register in the portal": "unrelated", "HTTPS only": "partial" })) });
    const events = await run("Example", deps);
    const r = resultOf(events);
    if (r?.type !== "result") throw new Error("no result");
    const step = r.guide.steps.find((c) => c.text === "Register in the portal")!;
    expect(step.confidence).toBe("unknown");
    expect(step.evidence).toEqual([]);
    const rule = r.guide.redirectRules.find((c) => c.text === "HTTPS only")!;
    expect(rule.confidence).toBe("docs");
    expect(rule.support).toBe("partial");
    expect(r.guide.gaps.some((g) => g.startsWith("Support check: 1 claim"))).toBe(true);
    expect(events.some((e) => e.type === "stage" && /not supported by their quote/.test(e.message))).toBe(true);
  });

  it("resets the verdict to unknown when its quote does not support it", async () => {
    const deps = mkDeps({ llm: llmWith(byText({ "review only to be listed": "unrelated" })) });
    const r = resultOf(await run("Example", deps));
    if (r?.type !== "result") throw new Error("no result");
    expect(r.guide.verdict.value).toBe("unknown");
    expect(r.guide.verdict.claim.confidence).toBe("unknown");
    expect(r.guide.gaps.some((g) => g.includes("did not fully support it"))).toBe(true);
  });

  it("also resets the verdict when its quote supports it only partly", async () => {
    const deps = mkDeps({ llm: llmWith(byText({ "review only to be listed": "partial" })) });
    const r = resultOf(await run("Example", deps));
    if (r?.type !== "result") throw new Error("no result");
    expect(r.guide.verdict.value).toBe("unknown");
    expect(r.guide.gaps.some((g) => g.includes("did not fully support it"))).toBe(true);
  });

  it("says so, and still returns the guide, when the judge is unavailable", async () => {
    const deps = mkDeps({ llm: llmWith(async () => { throw new RateLimitError(); }) });
    const events = await run("Example", deps);
    const r = resultOf(events);
    if (r?.type !== "result") throw new Error("no result");
    expect(r.guide.gaps.some((g) => g.startsWith("Support check did not run"))).toBe(true);
    expect(r.guide.steps[0].confidence).toBe("docs"); // provenance check still stands
  });

  it("leaves everything alone when every claim is supported", async () => {
    const r = resultOf(await run("Example", mkDeps({ llm: llmWith(byText({})) })));
    if (r?.type !== "result") throw new Error("no result");
    expect(r.guide.steps[0].support).toBeUndefined();
    expect(r.guide.gaps.some((g) => g.startsWith("Support check"))).toBe(false);
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
