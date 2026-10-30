import { promises as fs } from "node:fs";
import path from "node:path";
import { cacheLife } from "next/cache";
import { Guide } from "./schema";

const SEED_DIR = path.join(process.cwd(), "guides");
const TTL_SECONDS = 7 * 24 * 3600;
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;

export const isValidSlug = (s: string) => SLUG.test(s);

/** Seed guides ship in the repo: curated, human-reviewed. */
export async function getSeed(slug: string): Promise<Guide | null> {
  if (!isValidSlug(slug)) return null;
  try {
    const raw = await fs.readFile(path.join(SEED_DIR, `${slug}.json`), "utf8");
    return Guide.parse(JSON.parse(raw));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e; // a malformed seed should fail loudly, not silently disappear
  }
}

/** Seeds only change on deploy, so the listing is cached (also keeps the home page in the static shell). */
export async function listSeeds(): Promise<Guide[]> {
  "use cache";
  cacheLife("max");
  let files: string[] = [];
  try {
    files = (await fs.readdir(SEED_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const guides = await Promise.all(files.map((f) => getSeed(f.replace(/\.json$/, ""))));
  return guides.filter((g): g is Guide => g !== null).sort((a, b) => a.appName.localeCompare(b.appName));
}

/* Live guides: Upstash Redis over REST when configured, otherwise process memory (fine locally). */
const mem = new Map<string, { at: number; json: string }>();
const upstash = () => {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
};

async function redis(cmd: (string | number)[]): Promise<unknown> {
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

export async function getLive(slug: string): Promise<Guide | null> {
  if (!isValidSlug(slug)) return null;
  const key = `guide:${slug}`;
  let json: string | null = null;
  if (upstash()) {
    json = ((await redis(["GET", key])) as string | null) ?? null;
  } else {
    const hit = mem.get(key);
    if (hit && Date.now() - hit.at < TTL_SECONDS * 1000) json = hit.json;
  }
  if (!json) return null;
  const parsed = Guide.safeParse(JSON.parse(json));
  return parsed.success ? parsed.data : null;
}

export async function saveLive(guide: Guide): Promise<void> {
  if (!isValidSlug(guide.slug)) throw new Error("invalid slug");
  const key = `guide:${guide.slug}`;
  const json = JSON.stringify(guide);
  if (upstash()) await redis(["SET", key, json, "EX", TTL_SECONDS]);
  else mem.set(key, { at: Date.now(), json });
}

export async function getGuide(slug: string): Promise<Guide | null> {
  return (await getSeed(slug)) ?? (await getLive(slug));
}
