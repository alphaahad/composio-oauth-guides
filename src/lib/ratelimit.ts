import { redis, upstash } from "./storage";

/**
 * Per-IP and global request limits. When Redis is configured the counters live there, so every serverless instance
 * sees the same numbers. Without Redis (local development) they fall back to in-memory counters, which on serverless
 * would be per instance. Redis trouble never blocks a visitor: it falls back to the in-memory counters.
 */
const PER_IP = { max: 6, windowMs: 10 * 60_000 };
const GLOBAL = { max: 80, windowMs: 60 * 60_000 };

const ipHits = new Map<string, number[]>();
let globalHits: number[] = [];

const recent = (hits: number[], windowMs: number, now: number) => hits.filter((t) => now - t < windowMs);

export function checkRate(ip: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
  if (process.env.NODE_ENV !== "production" && process.env.DISABLE_RATE_LIMIT === "1") return { ok: true };
  globalHits = recent(globalHits, GLOBAL.windowMs, now);
  const mine = recent(ipHits.get(ip) ?? [], PER_IP.windowMs, now);

  if (globalHits.length >= GLOBAL.max) return { ok: false, retryAfterSec: Math.ceil((GLOBAL.windowMs - (now - globalHits[0])) / 1000) };
  if (mine.length >= PER_IP.max) return { ok: false, retryAfterSec: Math.ceil((PER_IP.windowMs - (now - mine[0])) / 1000) };

  mine.push(now);
  globalHits.push(now);
  ipHits.set(ip, mine);
  if (ipHits.size > 5000) for (const [k, v] of ipHits) if (recent(v, PER_IP.windowMs, now).length === 0) ipHits.delete(k);
  return { ok: true };
}

/** Fixed-window counter in Redis: INCR, start the expiry on the first hit, and read the TTL when over the limit. */
async function bump(key: string, max: number, windowSec: number): Promise<{ over: false } | { over: true; retryAfterSec: number }> {
  const n = Number(await redis(["INCR", key]));
  if (n === 1) await redis(["EXPIRE", key, windowSec]);
  if (n <= max) return { over: false };
  const ttl = Number(await redis(["TTL", key]));
  return { over: true, retryAfterSec: ttl > 0 ? ttl : windowSec };
}

export async function checkRateShared(ip: string): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  if (process.env.NODE_ENV !== "production" && process.env.DISABLE_RATE_LIMIT === "1") return { ok: true };
  if (!upstash()) return checkRate(ip);
  try {
    const mine = await bump(`rl:ip:${ip}`, PER_IP.max, PER_IP.windowMs / 1000);
    if (mine.over) return { ok: false, retryAfterSec: mine.retryAfterSec };
    const all = await bump("rl:global", GLOBAL.max, GLOBAL.windowMs / 1000);
    if (all.over) return { ok: false, retryAfterSec: all.retryAfterSec };
    return { ok: true };
  } catch {
    return checkRate(ip);
  }
}

export function resetRateLimit() {
  ipHits.clear();
  globalHits = [];
}
