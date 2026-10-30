const KEYWORDS = /oauth|authent|authoriz|app-review|verification|developer|scopes|permissions|api-access/i;

/** Last two host labels. Crude (wrong for co.uk-style suffixes) but only used to propose guesses and an "is this the same site" check. */
export function registrableDomain(host: string): string {
  const parts = host.replace(/^www\./, "").split(".");
  return parts.slice(-2).join(".");
}

export function sameSite(url: string, website: string): boolean {
  try {
    const d = registrableDomain(new URL(website).hostname);
    const h = new URL(url).hostname;
    return h === d || h.endsWith(`.${d}`);
  } catch {
    return false;
  }
}

/** Canonical form for comparing URLs the model hands back with ones we gave it (trailing slash, host case, fragment). */
export function urlKey(u: string): string {
  try {
    const x = new URL(u.trim());
    return `${x.protocol}//${x.host.toLowerCase()}${x.pathname.replace(/\/+$/, "")}${x.search}`;
  } catch {
    return u.trim().toLowerCase().replace(/\/+$/, "");
  }
}

/** Map URLs returned by the model back to the exact originals we offered; anything we did not offer is dropped. */
export function matchOffered(returned: string[], offered: string[]): string[] {
  const byKey = new Map(offered.map((o) => [urlKey(o), o]));
  const out: string[] = [];
  for (const r of returned) {
    const hit = byKey.get(urlKey(r));
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

/** Last-resort lead from a bare app name when no model is available: try its most common domain. */
export function guessWebsite(name: string): string | undefined {
  const base = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return base.length >= 2 ? `https://${base}.com` : undefined;
}

/** Likely documentation entry points for a site. Cheap to try; failures are silent. */
export function guessUrls(website: string): string[] {
  try {
    const d = registrableDomain(new URL(website).hostname);
    return [`https://developers.${d}`, `https://developer.${d}`, `https://docs.${d}`, `https://api.${d}`, `https://${d}/developers`, `https://${d}/docs`];
  } catch {
    return [];
  }
}

/** Pull documentation-looking links out of an llms.txt file (a curated index many docs sites publish). */
export function urlsFromLlmsTxt(text: string, limit = 4): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/https:\/\/[^\s)\]>"'`]+/g)) {
    const u = m[0].replace(/[.,;:]+$/, "");
    if (KEYWORDS.test(u) && !out.includes(u)) out.push(u);
    if (out.length >= limit) break;
  }
  return out;
}

const SKIP_EXT = /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|json|xml|pdf|zip|woff2?)(\?|$)/i;
const SCORES: [RegExp, number][] = [
  [/oauth/i, 6],
  [/authoriz/i, 5],
  [/authenticat/i, 4],
  [/app-review|verification|submit|publish/i, 4],
  [/scopes?|permissions?/i, 3],
  [/register|create-?(an-?)?(app|integration|connection)|get(ting)?-?started|quickstart|developer-portal|applications?|\bapps?\b|credentials|api-?keys?|integrations?/i, 2],
];

/** How likely a docs link is to explain OAuth app setup or approval, judged from its path and anchor text. 0 = not interesting. */
export function scoreLink(url: string, text = ""): number {
  try {
    const u = new URL(url);
    if (SKIP_EXT.test(u.pathname)) return 0;
    const target = `${u.pathname}${u.search} ${text}`;
    return SCORES.reduce((best, [re, n]) => (re.test(target) ? Math.max(best, n) : best), 0);
  } catch {
    return 0;
  }
}

/** Same-host links from `fromUrl`, scored and sorted best first. Pass minScore 1 to keep only plausible ones. */
export function rankLinks(links: { url: string; text?: string }[], fromUrl: string, minScore = 1): { url: string; text: string; score: number }[] {
  let host: string;
  try {
    host = new URL(fromUrl).hostname;
  } catch {
    return [];
  }
  return links
    .filter((l) => {
      try {
        const u = new URL(l.url);
        return u.hostname === host && !SKIP_EXT.test(u.pathname);
      } catch {
        return false;
      }
    })
    .map((l) => ({ url: l.url, text: l.text ?? "", score: scoreLink(l.url, l.text) }))
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score);
}
