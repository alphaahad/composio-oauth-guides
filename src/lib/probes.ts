import { assertPublicHttps } from "./fetcher";
import type { ProbeResult } from "./schema";

const PATHS = [
  { name: "OAuth server metadata (RFC 8414)", path: "/.well-known/oauth-authorization-server" },
  { name: "OpenID Connect discovery", path: "/.well-known/openid-configuration" },
] as const;

async function getJson(start: string): Promise<{ status: number; json?: unknown; finalUrl: string }> {
  let current = start;
  for (let hop = 0; hop < 3; hop++) {
    const url = await assertPublicHttps(current);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
      headers: { accept: "application/json", "user-agent": "oauth-guide-bot/0.1" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, url).toString();
      continue;
    }
    if (!res.ok) return { status: res.status, finalUrl: current };
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("json")) return { status: res.status, finalUrl: current };
    const text = (await res.text()).slice(0, 200_000);
    try {
      return { status: res.status, json: JSON.parse(text), finalUrl: current };
    } catch {
      return { status: res.status, finalUrl: current };
    }
  }
  return { status: 0, finalUrl: current };
}

export function describeMetadata(m: Record<string, unknown>): string {
  const bits: string[] = [];
  if (typeof m.authorization_endpoint === "string") bits.push(`authorize: ${m.authorization_endpoint}`);
  if (typeof m.token_endpoint === "string") bits.push(`token: ${m.token_endpoint}`);
  if (typeof m.registration_endpoint === "string")
    bits.push(`dynamic client registration available (${m.registration_endpoint}) - an app may be creatable without manual setup`);
  else bits.push("no dynamic client registration advertised");
  const pkce = m.code_challenge_methods_supported;
  if (Array.isArray(pkce)) bits.push(`PKCE: ${pkce.join(", ")}`);
  if (Array.isArray(m.scopes_supported)) bits.push(`${m.scopes_supported.length} scopes advertised`);
  return bits.join("; ");
}

/** Probe one specific URL, e.g. a provider's discovery document at a non-standard path. */
export async function probeUrl(name: string, url: string): Promise<ProbeResult> {
  const probedAt = new Date().toISOString();
  try {
    const r = await getJson(url);
    if (r.json && typeof r.json === "object") {
      return { name, url, ok: true, status: r.status, finding: describeMetadata(r.json as Record<string, unknown>), probedAt };
    }
    return { name, url, ok: false, status: r.status, finding: r.status ? `not published (HTTP ${r.status})` : "not reachable", probedAt };
  } catch (e) {
    return { name, url, ok: false, finding: `probe failed: ${e instanceof Error ? e.message : "error"}`, probedAt };
  }
}

/** Credential-free probes of well-known discovery documents. Most providers publish none; that is itself a finding. */
export async function probeOrigins(origins: string[]): Promise<ProbeResult[]> {
  const unique = [...new Set(origins)].slice(0, 3);
  const jobs = unique.flatMap((origin) =>
    PATHS.map(async ({ name, path }): Promise<ProbeResult> => {
      const url = origin + path;
      const probedAt = new Date().toISOString();
      try {
        const r = await getJson(url);
        if (r.json && typeof r.json === "object") {
          return { name, url, ok: true, status: r.status, finding: describeMetadata(r.json as Record<string, unknown>), probedAt };
        }
        return { name, url, ok: false, status: r.status, finding: r.status ? `not published (HTTP ${r.status})` : "not reachable", probedAt };
      } catch (e) {
        return { name, url, ok: false, finding: `probe failed: ${e instanceof Error ? e.message : "error"}`, probedAt };
      }
    }),
  );
  return Promise.all(jobs);
}
