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
  [/register|create-?(an-?)?(app|integration|connection)|getting-started|quickstart|developer-portal/i, 2],
];

/** How likely a docs link is to explain OAuth app setup or approval. 0 = not interesting. */
export function scoreLink(url: string): number {
  try {
    const u = new URL(url);
    if (SKIP_EXT.test(u.pathname)) return 0;
    const target = u.pathname + u.search;
    return SCORES.reduce((best, [re, n]) => (re.test(target) ? Math.max(best, n) : best), 0);
  } catch {
    return 0;
  }
}

/** Links on the same host as `fromUrl` that look relevant, best first. */
export function rankLinks(links: string[], fromUrl: string): { url: string; score: number }[] {
  let host: string;
  try {
    host = new URL(fromUrl).hostname;
  } catch {
    return [];
  }
  return links
    .filter((l) => {
      try {
        return new URL(l).hostname === host;
      } catch {
        return false;
      }
    })
    .map((url) => ({ url, score: scoreLink(url) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}
