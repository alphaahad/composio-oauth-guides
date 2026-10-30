/**
 * Best-effort in-memory limiter. On serverless each instance has its own counters, so this is a
 * brake on casual abuse and runaway cost, not a security boundary. Documented in the README.
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

export function resetRateLimit() {
  ipHits.clear();
  globalHits = [];
}
