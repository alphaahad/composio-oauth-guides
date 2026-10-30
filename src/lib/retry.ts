/** Thrown when every model hit its quota/rate limit, so callers can show a friendly message. */
export class RateLimitError extends Error {
  constructor() {
    super("The model is at its free-tier rate limit");
  }
}

export function isRateLimit(e: unknown): boolean {
  const status = (e as { status?: number } | null)?.status;
  const msg = e instanceof Error ? e.message : String(e);
  return status === 429 || /"code":\s*429|RESOURCE_EXHAUSTED/.test(msg);
}

/** Server-side blips from the model API (overload, gateway errors, dropped connections) worth a quick retry. */
export function isTransient(e: unknown): boolean {
  const status = (e as { status?: number } | null)?.status;
  const msg = e instanceof Error ? e.message : String(e);
  return (typeof status === "number" && [500, 502, 503, 504].includes(status)) || /"code":\s*(500|502|503|504)|UNAVAILABLE|high demand|ECONNRESET|fetch failed/i.test(msg);
}

export function isTimeout(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError" || /aborted due to timeout|timed out/i.test(e instanceof Error ? e.message : String(e));
}

export async function withRetry<T>(fn: () => Promise<T>, shouldRetry: (e: unknown) => boolean = isTransient, delaysMs: number[] = [800]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= delaysMs.length || !shouldRetry(e)) throw e;
      await new Promise((r) => setTimeout(r, delaysMs[attempt]));
    }
  }
}

/** "rate" = this model's quota; "model" = this model is down/slow/retired (another may work); "other" = our request is wrong. */
export function failKind(e: unknown): "rate" | "model" | "other" {
  if (isRateLimit(e)) return "rate";
  if (isTransient(e) || isTimeout(e) || (e as { status?: number } | null)?.status === 404) return "model";
  return "other";
}

export type Cooldown = Map<string, number>;

/**
 * Try models in order. A model that is overloaded, slow, retired, or out of quota is skipped for a while so one bad
 * model does not slow every request. Errors that another model cannot fix (a malformed request) are thrown immediately.
 */
export async function withModelFallback<T>(
  models: string[],
  call: (model: string) => Promise<T>,
  cooldown: Cooldown,
  opts: { now?: () => number; retryDelaysMs?: number[]; rateCooldownMs?: number; modelCooldownMs?: number } = {},
): Promise<T> {
  const now = opts.now ?? Date.now;
  const ready = models.filter((m) => (cooldown.get(m) ?? 0) <= now());
  const order = ready.length > 0 ? ready : models; // if everything is cooling down, try anyway
  let lastErr: unknown;
  let allRate = true;
  for (const m of order) {
    try {
      return await withRetry(() => call(m), isTransient, opts.retryDelaysMs ?? [800]);
    } catch (e) {
      const kind = failKind(e);
      if (kind === "other") throw e;
      lastErr = e;
      if (kind !== "rate") allRate = false;
      cooldown.set(m, now() + (kind === "rate" ? (opts.rateCooldownMs ?? 60_000) : (opts.modelCooldownMs ?? 120_000)));
    }
  }
  throw allRate ? new RateLimitError() : lastErr;
}
