import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRate, checkRateShared, resetRateLimit } from "../ratelimit";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetRateLimit();
});

describe("rate limit", () => {
  it("allows 6 per IP in the window, then tells the caller when to retry", () => {
    vi.stubEnv("NODE_ENV", "test");
    for (let i = 0; i < 6; i++) expect(checkRate("1.1.1.1", 1000 + i).ok).toBe(true);
    const r = checkRate("1.1.1.1", 2000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(checkRate("2.2.2.2", 2000).ok).toBe(true); // other visitors are unaffected
  });

  it("can be switched off for local development only", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DISABLE_RATE_LIMIT", "1");
    for (let i = 0; i < 20; i++) expect(checkRate("3.3.3.3", 1000 + i).ok).toBe(true);
  });

  it("ignores the switch in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DISABLE_RATE_LIMIT", "1");
    for (let i = 0; i < 6; i++) checkRate("4.4.4.4", 1000 + i);
    expect(checkRate("4.4.4.4", 2000).ok).toBe(false);
  });
});

describe("shared (Redis) rate limit", () => {
  // A tiny in-memory stand-in for the Upstash REST endpoint, so counters are shared across calls the way they are across instances.
  function fakeRedis() {
    const counts = new Map<string, number>();
    const calls: (string | number)[][] = [];
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.com");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("fetch", async (_u: string, init: { body: string }) => {
      const cmd = JSON.parse(init.body) as (string | number)[];
      calls.push(cmd);
      const [op, key] = cmd as [string, string];
      let result: number = 0;
      if (op === "INCR") result = counts.set(key, (counts.get(key) ?? 0) + 1).get(key)!;
      if (op === "TTL") result = 420;
      return new Response(JSON.stringify({ result }));
    });
    return { calls };
  }

  it("blocks the 7th request from one IP and reports the remaining window", async () => {
    const { calls } = fakeRedis();
    for (let i = 0; i < 6; i++) expect((await checkRateShared("9.9.9.9")).ok).toBe(true);
    const r = await checkRateShared("9.9.9.9");
    expect(r).toEqual({ ok: false, retryAfterSec: 420 });
    expect((await checkRateShared("8.8.8.8")).ok).toBe(true); // another visitor is unaffected
    expect(calls.filter((c) => c[0] === "EXPIRE")).toContainEqual(["EXPIRE", "rl:ip:9.9.9.9", 600]); // window starts on the first hit
  });

  it("enforces the global cap across all visitors", async () => {
    fakeRedis();
    let blocked = 0;
    for (let i = 0; i < 90; i++) if (!(await checkRateShared(`10.0.0.${i}`)).ok) blocked++;
    expect(blocked).toBe(10); // 80 allowed, then the rest are refused
  });

  it("never blocks a visitor because Redis is down: it falls back to the in-memory limit", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.com");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    for (let i = 0; i < 6; i++) expect((await checkRateShared("7.7.7.7")).ok).toBe(true);
    expect((await checkRateShared("7.7.7.7")).ok).toBe(false);
  });

  it("uses the in-memory limit when Redis is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"]) vi.stubEnv(k, "");
    for (let i = 0; i < 6; i++) expect((await checkRateShared("6.6.6.6")).ok).toBe(true);
    expect((await checkRateShared("6.6.6.6")).ok).toBe(false);
  });
});
