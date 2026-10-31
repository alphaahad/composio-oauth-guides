import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guideExists, isValidSlug } from "../storage";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "exists-test-"));
  vi.stubEnv("LIVE_DIR", dir);
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"]) vi.stubEnv(k, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("isValidSlug", () => {
  it("accepts lowercase slugs and rejects everything else", () => {
    expect(isValidSlug("github")).toBe(true);
    expect(isValidSlug("my-app-2")).toBe(true);
    for (const bad of ["", "UPPER", "-lead", "a_b", "a/b", "..", "a b", "a".repeat(61), "\0"]) expect(isValidSlug(bad)).toBe(false);
  });
});

describe("guideExists (decides 404 vs page before anything streams)", () => {
  it("is true for a curated guide and false for an unknown one", async () => {
    expect(await guideExists("github")).toBe(true);
    expect(await guideExists("definitely-not-a-guide")).toBe(false);
  });

  it("is false for invalid slugs without touching the disk or network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await guideExists("../package")).toBe(false);
    expect(await guideExists("GitHub")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("finds a fresh live guide and ignores an expired one", async () => {
    writeFileSync(join(dir, "fresh.json"), "{}");
    writeFileSync(join(dir, "old.json"), "{}");
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    utimesSync(join(dir, "old.json"), eightDaysAgo, eightDaysAgo);
    expect(await guideExists("fresh")).toBe(true);
    expect(await guideExists("old")).toBe(false);
  });

  it("asks Redis when it is configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.com");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ result: 1 })));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await guideExists("some-live-guide")).toBe(true);
    expect(JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual(["EXISTS", "guide:some-live-guide"]);
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ result: 0 })));
    expect(await guideExists("missing")).toBe(false);
  });
});
