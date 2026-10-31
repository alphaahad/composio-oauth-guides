import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Guide } from "../schema";

// store.ts imports next/cache for the cached seed listing; the live-guide functions do not use it.
vi.mock("next/cache", () => ({ cacheLife: () => {} }));

const guide = (slug: string, name: string): Guide => ({
  slug,
  appName: name,
  origin: "live",
  humanReviewed: false,
  generatedAt: "2026-10-31T00:00:00.000Z",
  usesOAuth: "yes",
  verdict: { value: "unknown", claim: { text: "", confidence: "unknown", evidence: [] } },
  summary: "s",
  composio: { managed: "unknown", note: "n", evidence: [] },
  effort: { text: "Unknown", confidence: "unknown", evidence: [] },
  wait: { text: "Not stated", confidence: "unknown", evidence: [] },
  blockerRisk: { value: "unknown", claim: { text: "Unknown", confidence: "unknown", evidence: [] } },
  scopeTiers: [], steps: [], redirectRules: [], requirements: [], gotchas: [],
  automation: { surface: "unknown", agentCan: [], youMust: [] },
  blocked: { contacts: [], usualRejections: [] },
  probes: [], sources: [], gaps: [],
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "live-test-"));
  vi.stubEnv("LIVE_DIR", dir);
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("KV_REST_API_TOKEN", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("live guide store", () => {
  it("saves a guide and reads it back by slug", async () => {
    const { saveLive, getLive } = await import("../store");
    await saveLive(guide("workday", "Workday"));
    expect((await getLive("workday"))?.appName).toBe("Workday");
    expect(await getLive("missing")).toBeNull();
  });

  it("lists guides newest first and respects the limit", async () => {
    const { saveLive, listLive } = await import("../store");
    await saveLive(guide("older", "Older"));
    await saveLive(guide("newer", "Newer"));
    utimesSync(join(dir, "older.json"), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    expect((await listLive(10)).map((g) => g.slug)).toEqual(["newer", "older"]);
    expect(await listLive(1)).toHaveLength(1);
  });

  it("skips corrupt files and never throws from listing", async () => {
    const { saveLive, listLive } = await import("../store");
    await saveLive(guide("ok", "Ok"));
    (await import("node:fs")).writeFileSync(join(dir, "bad.json"), "{not json");
    expect((await listLive(10)).map((g) => g.slug)).toEqual(["ok"]);
  });

  it("rejects unsafe slugs", async () => {
    const { saveLive, getLive } = await import("../store");
    await expect(saveLive(guide("../evil", "Evil"))).rejects.toThrow();
    expect(await getLive("../evil")).toBeNull();
  });
});
