import { describe, expect, it } from "vitest";
import { guessUrls, registrableDomain, sameSite, urlsFromLlmsTxt } from "../discovery";

describe("discovery helpers", () => {
  it("registrableDomain strips www and subdomains", () => {
    expect(registrableDomain("www.slack.com")).toBe("slack.com");
    expect(registrableDomain("api.slack.com")).toBe("slack.com");
  });
  it("sameSite accepts subdomains and rejects look-alikes", () => {
    expect(sameSite("https://docs.slack.com/x", "https://slack.com")).toBe(true);
    expect(sameSite("https://slack.com.evil.io/x", "https://slack.com")).toBe(false);
    expect(sameSite("https://notslack.com", "https://slack.com")).toBe(false);
    expect(sameSite("garbage", "https://slack.com")).toBe(false);
  });
  it("guessUrls proposes docs entry points on the registrable domain", () => {
    const g = guessUrls("https://www.example.com");
    expect(g).toContain("https://developers.example.com");
    expect(g).toContain("https://example.com/docs");
    expect(guessUrls("not a url")).toEqual([]);
  });
  it("urlsFromLlmsTxt keeps only doc-looking https links, deduped and capped", () => {
    const txt = `- [OAuth](https://docs.example.com/oauth): setup\n- [Blog](https://example.com/blog/hello)\n- [OAuth again](https://docs.example.com/oauth)\n- [Scopes](https://docs.example.com/scopes.md)\n- http://insecure.example.com/oauth`;
    expect(urlsFromLlmsTxt(txt)).toEqual(["https://docs.example.com/oauth", "https://docs.example.com/scopes.md"]);
    expect(urlsFromLlmsTxt(txt, 1)).toHaveLength(1);
  });
});

import { rankLinks, scoreLink } from "../discovery";
import { extractLinks } from "../fetcher";

describe("link following", () => {
  it("extractLinks reads html hrefs and markdown links, resolves relatives, drops non-https and fragments", () => {
    const raw = `<a href="/docs/oauth-2-0">x</a> <a href='https://other.com/a#frag'>y</a> <a href="http://insecure.com/z">n</a> <a href="#top">t</a> and [md](/docs/scopes) [abs](https://docs.example.com/app-review)`;
    expect(extractLinks(raw, "https://docs.example.com/overview").sort()).toEqual(
      ["https://docs.example.com/app-review", "https://docs.example.com/docs/oauth-2-0", "https://docs.example.com/docs/scopes", "https://other.com/a"].sort(),
    );
  });
  it("scoreLink prefers oauth over scopes over generic, and ignores assets", () => {
    expect(scoreLink("https://d.com/authentication/oauth-2-0")).toBeGreaterThan(scoreLink("https://d.com/reference/scopes"));
    expect(scoreLink("https://d.com/reference/scopes")).toBeGreaterThan(scoreLink("https://d.com/blog/hello"));
    expect(scoreLink("https://d.com/blog/hello")).toBe(0);
    expect(scoreLink("https://d.com/oauth.png")).toBe(0);
  });
  it("rankLinks keeps same-host relevant links, best first", () => {
    const r = rankLinks(
      ["https://d.com/blog/x", "https://d.com/scopes", "https://elsewhere.com/oauth", "https://d.com/oauth-guide"],
      "https://d.com/overview",
    );
    expect(r.map((x) => x.url)).toEqual(["https://d.com/oauth-guide", "https://d.com/scopes"]);
  });
});
