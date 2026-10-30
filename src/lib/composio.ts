import { assertPublicHttps } from "./fetcher";

const URL_MD = "https://docs.composio.dev/toolkits/managed-auth";
const TTL_MS = 60 * 60 * 1000;

export type Toolkit = { name: string; slug: string; managed: boolean };
export type ComposioLookup = {
  managed: "yes" | "no" | "unknown";
  note: string;
  matches: Toolkit[];
  sourceUrl: string;
  fetchedAt: string;
};

let cache: { at: number; toolkits: Toolkit[]; fetchedAt: string } | null = null;

const ROW = /^\|\s*\[([^\]]+)\]\([^)]*\)\s*\|\s*`([^`]+)`\s*\|/;

/** Parse the two tables on Composio's managed-auth page. Exported for tests. */
export function parseManagedAuth(md: string): Toolkit[] {
  const out: Toolkit[] = [];
  let managed = true; // rows before the "Bring your own" heading are managed
  for (const line of md.split("\n")) {
    if (/^##\s+Bring your own OAuth app/i.test(line)) managed = false;
    const m = ROW.exec(line.trim());
    if (m) out.push({ name: m[1].trim(), slug: m[2].trim(), managed });
  }
  return out;
}

async function loadToolkits() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const url = await assertPublicHttps(URL_MD);
  const res = await fetch(url, { headers: { accept: "text/markdown" }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const toolkits = parseManagedAuth(await res.text());
  if (toolkits.length < 20) throw new Error("managed-auth page format changed (too few rows parsed)");
  cache = { at: Date.now(), toolkits, fetchedAt: new Date().toISOString() };
  return cache;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function matchToolkits(app: string, toolkits: Toolkit[]): Toolkit[] {
  const a = norm(app);
  if (!a) return [];
  const exact = toolkits.filter((t) => norm(t.name) === a || norm(t.slug) === a);
  if (exact.length) return exact;
  // "google" -> Google Drive, Gmail-style families; require a meaningful prefix match
  return a.length >= 4 ? toolkits.filter((t) => norm(t.name).startsWith(a)) : [];
}

export async function lookupComposio(app: string): Promise<ComposioLookup> {
  try {
    const { toolkits, fetchedAt } = await loadToolkits();
    const matches = matchToolkits(app, toolkits);
    if (matches.length === 0) {
      return {
        managed: "unknown",
        note: `"${app}" is not in Composio's OAuth catalog (managed or bring-your-own). It may use another auth method or may not be a Composio toolkit.`,
        matches,
        sourceUrl: URL_MD,
        fetchedAt,
      };
    }
    const anyManaged = matches.some((m) => m.managed);
    const names = matches.slice(0, 4).map((m) => m.name).join(", ");
    return {
      managed: anyManaged ? "yes" : "no",
      note: anyManaged
        ? `Composio lists a managed OAuth app for ${names}${matches.length > 4 ? " and others" : ""}. You may not need your own unless you want your own branding, scopes beyond the defaults, or dedicated rate limits.`
        : `Composio lists ${names} as bring-your-own: you register the provider OAuth app yourself and supply its client ID and secret.`,
      matches,
      sourceUrl: URL_MD,
      fetchedAt,
    };
  } catch (e) {
    return {
      managed: "unknown",
      note: `Could not read Composio's managed-auth catalog (${e instanceof Error ? e.message : "error"}).`,
      matches: [],
      sourceUrl: URL_MD,
      fetchedAt: new Date().toISOString(),
    };
  }
}
