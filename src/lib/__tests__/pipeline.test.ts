import { describe, expect, it } from "vitest";
import { RateLimitError } from "../llm";
import { displayName, isPublicHostname, resolveInput, runPipeline, slugify, type Deps, type PipelineEvent } from "../pipeline";
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

  it("still tries the app's likely website when the model is down and only a name was given", async () => {
    const fetched: string[] = [];
    const deps = mkDeps({
      fetchPage: async (url) => { fetched.push(url); return { ok: false as const, url, error: "HTTP 404" }; },
      llm: { discover: async () => { throw new Error("503"); }, classify: async () => new Set(), extract: async () => extraction() },
    });
    await run("Typeform", deps);
    expect(fetched).toContain("https://typeform.com/");
    expect(fetched).toContain("https://developers.typeform.com/");
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
  const ok = (url: string, text = DOC_TEXT, links: (string | { url: string; text: string })[] = []) => ({ ok: true as const, status: 200, page: { url, title: url, text, fetchedAt: "2026-10-30T00:00:00.000Z" }, links: links.map((l) => (typeof l === "string" ? { url: l, text: "" } : l)) });

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

  it("lets the model pick links the keyword scorer would miss, and ignores ones it rejects", async () => {
    const ODD = "https://docs.example.com/x/9f3a";
    const fetched: string[] = [];
    const deps = mkDeps({
      fetchPage: async (url) => { fetched.push(url); return url === LANDING ? ok(LANDING, "Welcome to the docs. ".repeat(30), [{ url: ODD, text: "Set up your connection" }, { url: OAUTH, text: "OAuth" }]) : ok(url); },
      llm: { discover: async () => ({ urls: [{ url: LANDING }] }), classify: async () => new Set([LANDING]), extract: async () => extraction(), pickLinks: async () => [ODD] },
    });
    await run("Example", deps);
    expect(fetched).toContain(ODD);
    expect(fetched).not.toContain(OAUTH); // the model rejected it, even though it scores higher by keyword
  });

  it("follows nothing when the model says no link is relevant", async () => {
    const fetched: string[] = [];
    const deps = mkDeps({
      fetchPage: async (url) => { fetched.push(url); return url === LANDING ? ok(LANDING, "Welcome to the docs. ".repeat(30), [OAUTH]) : ok(url); },
      llm: { discover: async () => ({ urls: [{ url: LANDING }] }), classify: async () => new Set([LANDING]), extract: async () => extraction(), pickLinks: async () => [] },
    });
    await run("Example", deps);
    expect(fetched).not.toContain(OAUTH);
  });

  it("falls back to keyword scores when the model cannot pick", async () => {
    const fetched: string[] = [];
    const deps = mkDeps({
      fetchPage: async (url) => { fetched.push(url); return url === LANDING ? ok(LANDING, "Welcome to the docs. ".repeat(30), [OAUTH]) : ok(url); },
      llm: { discover: async () => ({ urls: [{ url: LANDING }] }), classify: async () => new Set([LANDING]), extract: async () => extraction(), pickLinks: async () => { throw new RateLimitError(); } },
    });
    await run("Example", deps);
    expect(fetched).toContain(OAUTH);
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

describe("verdict from absence", () => {
  const two = (over = {}) => {
    const A = "https://docs.example.com/a";
    const B = "https://docs.example.com/b";
    return mkDeps({
      llm: { discover: async () => ({ urls: [{ url: A }, { url: B }] }), classify: async () => new Set([A, B]), extract: async () => extraction({ verdict: "no-approval-needed", verdictItem: item("Register and go", "Register your app in the developer portal."), ...over }) },
      fetchPage: async (url) => ({ ok: true as const, status: 200, page: { url, title: url, text: DOC_TEXT + url, fetchedAt: "2026-10-30T00:00:00.000Z" } }),
    });
  };

  it("keeps 'no approval needed' as an inference when enough official pages were read", async () => {
    const r = resultOf(await run("Example", two()));
    if (r?.type !== "result") throw new Error("no result");
    expect(r.guide.verdict.value).toBe("no-approval-needed");
    expect(r.guide.verdict.claim.confidence).toBe("inferred");
    expect(r.guide.verdict.claim.text).toMatch(/None of the 2 official pages/);
  });

  it("refuses to infer an absence from a single page", async () => {
    const onlyOne = mkDeps(
      { fetchPage: async (url) => (url === DOC_URL ? { ok: true as const, status: 200, page: { url, title: "Docs", text: DOC_TEXT, fetchedAt: "2026-10-30T00:00:00.000Z" } } : { ok: false as const, url, error: "HTTP 404" }) },
      extraction({ verdict: "no-approval-needed" }),
    );
    const r = resultOf(await run("Example", onlyOne));
    if (r?.type !== "result") throw new Error("no result");
    expect(r.guide.verdict.value).toBe("unknown");
    expect(r.guide.gaps.some((g) => g.includes("too few official pages"))).toBe(true);
  });

  it("is not reset by the support check (it is an inference, not a quote claim)", async () => {
    const deps = two();
    deps.llm.judge = async (items) => new Map(items.map((i) => [i.id, "unrelated" as const]));
    const r = resultOf(await run("Example", deps));
    if (r?.type !== "result") throw new Error("no result");
    expect(r.guide.verdict.value).toBe("no-approval-needed");
  });
});

describe("depends verdict", () => {
  it("is kept when its quote supports it (it is a quote claim, unlike no-approval-needed)", async () => {
    const r = resultOf(await run("Example", mkDeps({}, extraction({ verdict: "depends", verdictItem: item("Open and gated paths", "Apps listed in the marketplace go through review.") }))));
    if (r?.type !== "result") throw new Error("no result");
    expect(r.guide.verdict.value).toBe("depends");
    expect(r.guide.verdict.claim.confidence).toBe("docs");
  });
});

describe("url matching", () => {
  it("maps the model's slightly different URLs back to the ones we offered", async () => {
    const { matchOffered, urlKey } = await import("../discovery");
    expect(urlKey("https://WWW.Example.com/Docs/#x")).toBe("https://www.example.com/Docs");
    expect(matchOffered(["https://www.typeform.com", "https://evil.com/x"], ["https://www.typeform.com/", "https://other.com/"])).toEqual(["https://www.typeform.com/"]);
  });
});

describe("thin or irrelevant sources (regression: the Workday guide)", () => {
  it("replaces the model's prose when no page could be confirmed as official, instead of repeating a possibly false claim", async () => {
    const deps = mkDeps({
      llm: { discover: async () => ({ urls: [{ url: DOC_URL }] }), classify: async () => new Set(), extract: async () => extraction({ summary: "This provider has no OAuth flow.", usesOAuth: "no" }) },
    });
    const r = resultOf(await run("workday", deps));
    if (r?.type !== "result") throw new Error("no result");
    expect(r.guide.summary).toMatch(/could not confirm any of the pages/i);
    expect(r.guide.summary).not.toMatch(/no OAuth flow/);
    expect(r.guide.usesOAuth).toBe("unclear");
    expect(r.guide.gaps.some((g) => /provider's own developer documentation/.test(g))).toBe(true);
    expect(r.guide.effort.confidence).toBe("unknown");
  });

  it("says so when documentation pages need a login", async () => {
    const deps = mkDeps({
      fetchPage: async (url) => (url === DOC_URL ? { ok: true as const, status: 200, page: { url, title: "Docs", text: DOC_TEXT, fetchedAt: "2026-10-30T00:00:00.000Z" } } : { ok: false as const, url, error: "HTTP 401", status: 401 }),
      llm: { discover: async () => ({ urls: [{ url: DOC_URL }, { url: "https://community.example.com/docs" }] }), classify: async () => new Set([DOC_URL]), extract: async () => extraction() },
    });
    const r = resultOf(await run("Example", deps));
    if (r?.type !== "result") throw new Error("no result");
    expect(r.guide.gaps.some((g) => /needs a login/.test(g))).toBe(true);
  });

  it("explains a gaps-only guide when every page was behind a login", async () => {
    const deps = mkDeps({ fetchPage: async (url) => ({ ok: false as const, url, error: "HTTP 401", status: 401 }) });
    const r = resultOf(await run("Example", deps));
    if (r?.type !== "result") throw new Error("no result");
    expect(r.guide.summary).toMatch(/appears to need a login/);
  });

  it("groups repeated fetch failures on one host into a single warning", async () => {
    const urls = ["https://m.example.com/a", "https://m.example.com/b", "https://m.example.com/c", DOC_URL];
    const deps = mkDeps({
      fetchPage: async (url) => (url === DOC_URL ? { ok: true as const, status: 200, page: { url, title: "Docs", text: DOC_TEXT, fetchedAt: "2026-10-30T00:00:00.000Z" } } : { ok: false as const, url, error: "HTTP 404", status: 404 }),
      llm: { discover: async () => ({ urls: urls.map((url) => ({ url })) }), classify: async () => new Set(urls), extract: async () => extraction() },
    });
    const events = await run("Example", deps);
    const warns = events.filter((e) => e.type === "stage" && e.status === "warn" && /Could not read.*m\.example\.com/.test(e.message));
    expect(warns).toHaveLength(1);
    expect(warns[0].type === "stage" && warns[0].message).toBe("Could not read 3 pages on m.example.com: HTTP 404");
  });

  it("reports each slow discovery step, so the page never sits silent", async () => {
    const urls = [DOC_URL, "https://other.example.com/page"];
    const deps = mkDeps({ llm: { discover: async () => ({ urls: urls.map((url) => ({ url })) }), classify: async () => new Set([DOC_URL]), extract: async () => extraction() } });
    const messages = (await run("Example", deps)).flatMap((e) => (e.type === "stage" && e.stage === "discover" ? [e.message] : []));
    expect(messages.some((m) => /Asking the model/.test(m))).toBe(true);
    expect(messages.some((m) => /model suggested 2/.test(m))).toBe(true);
    expect(messages.some((m) => /Sorting official pages/.test(m))).toBe(true);
    expect(messages.some((m) => /candidate page/.test(m))).toBe(true);
  });

  it("title-cases a plain lowercase name", () => {
    expect(resolveInput("workday").name).toBe("Workday");
    expect(resolveInput("google drive").name).toBe("Google Drive");
    expect(resolveInput("iPhone").name).toBe("iPhone");
    expect(resolveInput("x").name).toBe("X");
  });

  it("never shows a zero or inverted effort estimate", async () => {
    for (const effortHours of [{ minHours: 0, maxHours: 0, basis: "none" }, { minHours: 5, maxHours: 2, basis: "x" }]) {
      const r = resultOf(await run("Example", mkDeps({}, extraction({ effortHours }))));
      if (r?.type !== "result") throw new Error("no result");
      expect(r.guide.effort.text).toMatch(/^Unknown/);
    }
  });

  it("uses the model's properly cased name when it is the same name as typed", async () => {
    const r = resultOf(await run("example", mkDeps({}, extraction({ appName: "Example" }))));
    if (r?.type !== "result") throw new Error("no result");
    expect(r.guide.appName).toBe("Example");
    expect(displayName("workday", "Workday")).toBe("Workday");
    expect(displayName("workday", "Totally Different")).toBe("workday");
    expect(displayName("x", "")).toBe("x");
  });
});

describe("helpers", () => {
  it("resolveInput handles names and URLs", () => {
    expect(resolveInput("Slack")).toEqual({ name: "Slack" });
    expect(resolveInput("https://www.notion.so/product")).toEqual({ name: "Notion", website: "https://www.notion.so" });
    expect(resolveInput("developer.github.com").name).toBe("Github");
    expect(() => resolveInput("x".repeat(101))).toThrow();
  });
  it("slugify keeps clean names clean", () => {
    expect(slugify("Google Drive")).toBe("google-drive");
    expect(slugify("GitHub")).toBe("github");
    expect(slugify("Cal.com")).toBe("cal-com");
  });
});

describe("slugs never collide for different apps (regression: every non-Latin name became 'app')", () => {
  it("adds a stable hash when characters are lost", () => {
    expect(slugify("C++")).not.toBe(slugify("C#"));
    expect(slugify("C++")).toMatch(/^c-[a-z0-9]{4,6}$/);
    expect(slugify("日本語アプリ")).toMatch(/^app-[a-z0-9]{4,6}$/);
    expect(slugify("日本語アプリ")).not.toBe(slugify("中文应用"));
    expect(slugify("日本語アプリ")).toBe(slugify("日本語アプリ")); // stable
    expect(slugify("???")).toMatch(/^app-[a-z0-9]{4,6}$/);
  });
  it("always yields a valid slug", () => {
    for (const n of ["C++", "日本語アプリ", "A".repeat(100), "😀", "AT&T", "x"]) expect(slugify(n)).toMatch(/^[a-z0-9][a-z0-9-]{0,59}$/);
  });
});

describe("input validation (regression: junk and internal addresses were accepted)", () => {
  it.each([
    "169.254.169.254",
    "http://169.254.169.254/latest/meta-data",
    "http://127.0.0.1",
    "https://127.0.0.1:3000",
    "localhost:3000",
    "http://localhost:3000",
    "https://[::1]/",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,<b>x</b>",
    "<script>alert(1)</script>",
    "../../etc/passwd",
    "'; DROP TABLE guides; --",
    "http://user:pw@example.com",
    "https://intranet",
    "http://printer.local",
    "10.0.0.1",
    "foo\u0007bar",
    "a".repeat(101),
    "   ",
  ])("rejects %j", (input) => {
    expect(() => resolveInput(input)).toThrow(/app name or a public website/);
  });

  it.each(["Slack", "GitHub", "google drive", "C++", "C#", "AT&T", "O'Reilly", "Microsoft 365", "Zoho Mail", "x", "日本語アプリ", "Dr. Chrono"])("accepts the app name %j", (input) => {
    expect(() => resolveInput(input)).not.toThrow();
  });

  it("title-cases plain lowercase names, including non-ASCII letters", () => {
    expect(resolveInput("zoho mail").name).toBe("Zoho Mail");
    expect(resolveInput("éclair").name).toBe("Éclair");
  });

  it("accepts public websites and derives a sensible name", () => {
    expect(resolveInput("https://www.notion.so/product")).toEqual({ name: "Notion", website: "https://www.notion.so" });
    expect(resolveInput("developer.atlassian.com").name).toBe("Atlassian");
    expect(resolveInput("https://docs.example.co.uk/x").name).toBe("Example");
    expect(resolveInput("example.com:8080/path").website).toBe("https://example.com");
  });

  it("isPublicHostname rules", () => {
    for (const h of ["slack.com", "docs.github.com", "a-b.co.uk", "xn--bcher-kva.de"]) expect(isPublicHostname(h)).toBe(true);
    for (const h of ["localhost", "127.0.0.1", "10.0.0.1", "::1", "[::1]", "intranet", "x.local", "x.internal", "a..b.com", "-bad.com", "bad-.com", "x.123"]) expect(isPublicHostname(h)).toBe(false);
  });
});
