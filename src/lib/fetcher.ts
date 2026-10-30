import { lookup } from "node:dns/promises";
import net from "node:net";
import type { FetchedPage } from "./verify";

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const ALLOWED_TYPES = ["text/html", "text/plain", "text/markdown", "application/json", "application/xml", "text/xml"];

export class BlockedUrlError extends Error {}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      a >= 224 // multicast/reserved
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true; // not an IP we understand: refuse
}

/** Throws BlockedUrlError unless the URL is https and every resolved address is public. */
export async function assertPublicHttps(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError("invalid URL");
  }
  if (url.protocol !== "https:") throw new BlockedUrlError("only https URLs are allowed");
  if (url.username || url.password) throw new BlockedUrlError("credentials in URL not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new BlockedUrlError("local hostnames are not allowed");
  }
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
    throw new BlockedUrlError("resolves to a non-public address");
  }
  return url;
}

export function htmlToText(html: string): { title?: string; text: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
  const text = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|pre|section|article|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // inline tags vanish without leaving a space ("<b>Save</b>." must stay "Save."); other tags separate words
    .replace(/<\/?(a|b|i|u|s|em|strong|code|kbd|span|abbr|small|sub|sup|mark|samp|var|tt)(\s[^>]*)?>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity)
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return { title: title ? decodeBasic(title) : undefined, text };
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"',
  mdash: "-", ndash: "-", hellip: "...", copy: "(c)", middot: "·", rarr: "->",
};

/** Single-pass decode so "&amp;lt;" becomes "&lt;" and not "<". Unknown entities are left as-is. */
function decodeEntity(whole: string, body: string): string {
  try {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
  } catch {
    return whole;
  }
  return NAMED[body.toLowerCase()] ?? whole;
}

function decodeBasic(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity);
}

/** Absolute https links from raw HTML or markdown, resolved against `base`. Used to follow docs links one hop. */
export function extractLinks(raw: string, base: string, cap = 400): string[] {
  const out = new Set<string>();
  const add = (href: string) => {
    try {
      const u = new URL(href.trim(), base);
      if (u.protocol !== "https:") return;
      u.hash = "";
      out.add(u.toString());
    } catch {
      /* ignore malformed hrefs */
    }
  };
  for (const m of raw.matchAll(/href\s*=\s*["']([^"'#][^"']*)["']/gi)) add(m[1]);
  for (const m of raw.matchAll(/\]\(([^)\s]+)\)/g)) add(m[1]);
  return [...out].slice(0, cap);
}

export type FetchResult =
  | { ok: true; page: FetchedPage; status: number; links?: string[] }
  | { ok: false; url: string; error: string; status?: number };

export async function fetchPage(rawUrl: string): Promise<FetchResult> {
  let current = rawUrl;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const url = await assertPublicHttps(current);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, {
          redirect: "manual",
          signal: ctrl.signal,
          headers: {
            "user-agent": "oauth-guide-bot/0.1 (documentation research tool)",
            accept: "text/markdown,text/html;q=0.9,text/plain;q=0.8,*/*;q=0.1", // many docs sites serve clean markdown when asked
          },
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, url: rawUrl, error: "redirect without location", status: res.status };
        current = new URL(loc, url).toString();
        continue;
      }
      if (!res.ok) return { ok: false, url: current, error: `HTTP ${res.status}`, status: res.status };

      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (type && !ALLOWED_TYPES.includes(type)) {
        return { ok: false, url: current, error: `unsupported content-type ${type}`, status: res.status };
      }

      const body = await readCapped(res);
      const isHtml = type === "text/html" || /^\s*<(!doctype|html)/i.test(body);
      const { title, text } = isHtml ? htmlToText(body) : { title: undefined, text: body };
      if (text.trim().length < 200) {
        return { ok: false, url: current, error: "page has too little readable text (likely JS-rendered)", status: res.status };
      }
      return {
        ok: true,
        status: res.status,
        page: { url: current, title, text, fetchedAt: new Date().toISOString() },
        links: extractLinks(body, current),
      };
    }
    return { ok: false, url: rawUrl, error: "too many redirects" };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : String(e);
    return { ok: false, url: rawUrl, error: msg };
  }
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      break; // keep what we have; truncated pages are still usable evidence
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
