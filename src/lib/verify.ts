import type { Claim, Evidence, ExtractedItem } from "./schema";

export type FetchedPage = {
  url: string;
  title?: string;
  text: string;
  fetchedAt: string;
  /** false = community/third-party page; its verified quotes become "reported", not "docs". Default true. */
  official?: boolean;
};

const MIN_QUOTE = 12;
const MAX_QUOTE = 400;

/** Collapse the differences that don't change meaning (case, whitespace, smart quotes, markdown markers). */
export function normalize(s: string): string {
  return s
    // markdown links and inline HTML sit in the middle of sentences on some docs sites; matching must see through them
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[a-z][a-z0-9-]*(\s[^>]*)?\/?>/gi, " ")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .replace(/[`*_#>]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?)\]])/g, "$1") // "Register application ." == "Register application."
    .replace(/([(\[])\s+/g, "$1")
    .trim()
    .toLowerCase();
}

export function quoteInText(quote: string, text: string): boolean {
  const q = normalize(quote);
  if (q.length < MIN_QUOTE || q.length > MAX_QUOTE) return false;
  return normalize(text).includes(q);
}

/** Canonical form for matching a model-cited URL to a page we actually fetched. */
function urlKey(u: string): string {
  try {
    const x = new URL(u);
    return (x.host + x.pathname).replace(/\/+$/, "").toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

export type Verification = { claim: Claim; verified: boolean; reason?: string };

/**
 * Turn a model-extracted item into a Claim. The quote must be a substring of the page it cites
 * (or, if the cited URL wasn't fetched, of some other fetched page, in which case we re-point the
 * citation). If it fails, the text is kept but downgraded to "unknown" with no evidence, so it is
 * visibly unsupported instead of silently trusted.
 */
export function verifyItem(item: ExtractedItem, pages: FetchedPage[]): Verification {
  const text = item.text.trim();
  const quote = item.quote.trim();

  if (!quote) {
    return { claim: { text, confidence: "unknown", evidence: [] }, verified: false, reason: "no quote" };
  }

  const cited = pages.find((p) => urlKey(p.url) === urlKey(item.sourceUrl));
  if (cited && quoteInText(quote, cited.text)) {
    return { claim: docsClaim(text, cited, quote), verified: true };
  }

  const other = pages.find((p) => quoteInText(quote, p.text));
  if (other) {
    return { claim: docsClaim(text, other, quote), verified: true, reason: "citation re-pointed" };
  }

  return {
    claim: { text, confidence: "unknown", evidence: [] },
    verified: false,
    reason: "quote not found in any fetched page",
  };
}

function docsClaim(text: string, page: FetchedPage, quote: string): Claim {
  const evidence: Evidence = { url: page.url, quote, fetchedAt: page.fetchedAt };
  return { text, confidence: page.official === false ? "reported" : "docs", evidence: [evidence] };
}

export type VerifyStats = { total: number; verified: number; dropped: number };

export function verifyList(items: ExtractedItem[], pages: FetchedPage[]) {
  const results = items.map((i) => verifyItem(i, pages));
  const stats: VerifyStats = {
    total: results.length,
    verified: results.filter((r) => r.verified).length,
    dropped: results.filter((r) => !r.verified).length,
  };
  return { claims: results.map((r) => r.claim), stats };
}
