import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/* Low-level storage helpers, kept free of Next's cache directives so the request proxy can import them. */

export const TTL_SECONDS = 7 * 24 * 3600;
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;

export const isValidSlug = (s: string) => SLUG.test(s);

export const liveDirs = () => (process.env.LIVE_DIR ? [process.env.LIVE_DIR] : [path.join(process.cwd(), ".data", "live"), path.join(os.tmpdir(), "oauth-guides-live")]);

export const upstash = () => {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
};

export async function redis(cmd: (string | number)[]): Promise<unknown> {
  const u = upstash()!;
  const res = await fetch(u.url, {
    method: "POST",
    headers: { authorization: `Bearer ${u.token}`, "content-type": "application/json" },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`store HTTP ${res.status}`);
  return ((await res.json()) as { result: unknown }).result;
}

/** Cheap existence check used before a guide page renders, so a missing guide is a real 404 and not a streamed 200. */
export async function guideExists(slug: string): Promise<boolean> {
  if (!isValidSlug(slug)) return false;
  try {
    await fs.access(path.join(process.cwd(), "guides", `${slug}.json`));
    return true;
  } catch {
    /* not a curated guide */
  }
  if (upstash()) return (await redis(["EXISTS", `guide:${slug}`])) === 1;
  for (const dir of liveDirs()) {
    try {
      const stat = await fs.stat(path.join(dir, `${slug}.json`));
      if (Date.now() - stat.mtimeMs <= TTL_SECONDS * 1000) return true;
    } catch {
      /* try the next location */
    }
  }
  return false;
}
