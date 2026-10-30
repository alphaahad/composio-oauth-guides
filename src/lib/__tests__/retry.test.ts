import { describe, expect, it } from "vitest";
import { isTransient, withRetry } from "../retry";

const err503 = Object.assign(new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}'), { status: 503 });
const err429 = Object.assign(new Error("quota"), { status: 429 });

describe("retry", () => {
  it("classifies transient vs non-transient errors", () => {
    expect(isTransient(err503)).toBe(true);
    expect(isTransient(new Error("fetch failed"))).toBe(true);
    expect(isTransient(err429)).toBe(false); // quota: retrying only burns more of it
    expect(isTransient(new Error("invalid argument"))).toBe(false);
  });
  it("retries a transient failure and returns the eventual success", async () => {
    let calls = 0;
    const out = await withRetry(async () => { if (++calls < 3) throw err503; return "ok"; }, isTransient, [0, 0]);
    expect(out).toBe("ok");
    expect(calls).toBe(3);
  });
  it("gives up after the delays are exhausted", async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw err503; }, isTransient, [0, 0])).rejects.toBe(err503);
    expect(calls).toBe(3);
  });
  it("does not retry non-transient errors", async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw err429; }, isTransient, [0, 0])).rejects.toBe(err429);
    expect(calls).toBe(1);
  });
});

import { RateLimitError, withModelFallback, failKind, isTimeout } from "../retry";

const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
const retired = Object.assign(new Error("no longer available to new users"), { status: 404 });
const bad = Object.assign(new Error("invalid argument"), { status: 400 });
const opts = { retryDelaysMs: [0], now: () => 1000 };

describe("model fallback", () => {
  it("classifies failures", () => {
    expect(failKind(err429)).toBe("rate");
    expect(failKind(err503)).toBe("model");
    expect(failKind(timeout)).toBe("model");
    expect(failKind(retired)).toBe("model");
    expect(failKind(bad)).toBe("other");
    expect(isTimeout(timeout)).toBe(true);
  });

  it("falls through to the next model when one is overloaded, slow, or retired", async () => {
    const tried: string[] = [];
    const out = await withModelFallback(["a", "b", "c", "d"], async (m) => {
      tried.push(m);
      if (m === "a") throw err503;
      if (m === "b") throw timeout;
      if (m === "c") throw retired;
      return `from ${m}`;
    }, new Map(), opts);
    expect(out).toBe("from d");
    expect(tried).toEqual(["a", "a", "b", "c", "d"]); // only the 503 is retried on the same model
  });

  it("skips a model that just failed, instead of hanging on it again", async () => {
    const cooldown = new Map<string, number>();
    const tried: string[] = [];
    const call = async (m: string) => { tried.push(m); if (m === "a") throw timeout; return m; };
    await withModelFallback(["a", "b"], call, cooldown, opts);
    tried.length = 0;
    await withModelFallback(["a", "b"], call, cooldown, opts);
    expect(tried).toEqual(["b"]);
  });

  it("tries cooling-down models anyway when nothing else is left", async () => {
    const cooldown = new Map([["a", 5000]]);
    const out = await withModelFallback(["a"], async (m) => m, cooldown, opts);
    expect(out).toBe("a");
  });

  it("reports a rate limit only when every model hit its quota", async () => {
    await expect(withModelFallback(["a", "b"], async () => { throw err429; }, new Map(), opts)).rejects.toBeInstanceOf(RateLimitError);
    await expect(withModelFallback(["a", "b"], async (m) => { throw m === "a" ? err429 : err503; }, new Map(), opts)).rejects.toBe(err503);
  });

  it("throws immediately on an error another model cannot fix", async () => {
    const tried: string[] = [];
    await expect(withModelFallback(["a", "b"], async (m) => { tried.push(m); throw bad; }, new Map(), opts)).rejects.toBe(bad);
    expect(tried).toEqual(["a"]);
  });
});
