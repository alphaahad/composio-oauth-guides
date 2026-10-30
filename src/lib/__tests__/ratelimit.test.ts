import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRate, resetRateLimit } from "../ratelimit";

afterEach(() => {
  vi.unstubAllEnvs();
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
