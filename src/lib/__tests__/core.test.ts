import { describe, expect, it } from "vitest";
import { assertPublicHttps, BlockedUrlError, htmlToText, isPrivateIp } from "../fetcher";
import { normalize, quoteInText, verifyItem, verifyList } from "../verify";
import type { FetchedPage } from "../verify";

const page: FetchedPage = {
  url: "https://docs.example.com/oauth/",
  fetchedAt: "2026-10-30T00:00:00.000Z",
  text: `Redirect URLs must use HTTPS. A Redirect URL can not contain an anchor (#).
The preliminary review takes up to 10 business days — functional review "takes up to 10 weeks".`,
};

describe("verifier", () => {
  it("accepts a verbatim quote and marks it docs", () => {
    const r = verifyItem(
      { text: "HTTPS only", sourceUrl: page.url, quote: "Redirect URLs must use HTTPS." },
      [page],
    );
    expect(r.verified).toBe(true);
    expect(r.claim.confidence).toBe("docs");
    expect(r.claim.evidence[0].url).toBe(page.url);
  });

  it("tolerates case, whitespace, smart quotes and dashes", () => {
    expect(quoteInText("the preliminary   review takes up to 10 business days - functional", page.text)).toBe(true);
    expect(quoteInText("functional review “takes up to 10 weeks”", page.text)).toBe(true);
  });

  it("rejects a fabricated quote and downgrades to unknown with no evidence", () => {
    const r = verifyItem(
      { text: "Review takes 2 days", sourceUrl: page.url, quote: "Review is completed within 2 business days" },
      [page],
    );
    expect(r.verified).toBe(false);
    expect(r.claim.confidence).toBe("unknown");
    expect(r.claim.evidence).toEqual([]);
  });

  it("rejects empty and too-short quotes", () => {
    expect(verifyItem({ text: "x", sourceUrl: page.url, quote: "" }, [page]).verified).toBe(false);
    expect(verifyItem({ text: "x", sourceUrl: page.url, quote: "HTTPS" }, [page]).verified).toBe(false);
  });

  it("re-points a citation when the quote is on a different fetched page", () => {
    const other: FetchedPage = { ...page, url: "https://docs.example.com/other", text: "Apps must support SSL for redirect URLs." };
    const r = verifyItem(
      { text: "SSL", sourceUrl: "https://docs.example.com/wrong", quote: "Apps must support SSL for redirect URLs." },
      [page, other],
    );
    expect(r.verified).toBe(true);
    expect(r.claim.evidence[0].url).toBe(other.url);
  });

  it("matches cited URLs ignoring trailing slash and scheme noise", () => {
    const r = verifyItem(
      { text: "HTTPS", sourceUrl: "https://docs.example.com/oauth", quote: "Redirect URLs must use HTTPS." },
      [page],
    );
    expect(r.verified).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it("reports stats", () => {
    const { stats } = verifyList(
      [
        { text: "a", sourceUrl: page.url, quote: "Redirect URLs must use HTTPS." },
        { text: "b", sourceUrl: page.url, quote: "totally made up sentence here" },
      ],
      [page],
    );
    expect(stats).toEqual({ total: 2, verified: 1, dropped: 1 });
  });

  it("ignores stray spaces before punctuation left by tag stripping", () => {
    const text = htmlToText("<li>Click <strong>Register application</strong>.</li><li>See <a href='/x'>Authorizing OAuth apps</a> (and <code>more</code>) .</li>").text;
    expect(text).toContain("Register application.");
    expect(quoteInText("Click Register application.", text)).toBe(true);
    expect(quoteInText("Click Register application .", "Click Register application.")).toBe(true);
    expect(quoteInText("See Authorizing OAuth apps (and more).", text)).toBe(true);
  });

  it("normalize strips markdown markers", () => {
    expect(normalize("**Bold** `code`")).toBe("bold code");
  });
});

describe("fetcher SSRF guard", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
  ])("treats %s as private", (ip) => expect(isPrivateIp(ip)).toBe(true));

  it.each(["8.8.8.8", "140.82.112.3", "2606:4700:4700::1111"])("treats %s as public", (ip) =>
    expect(isPrivateIp(ip)).toBe(false),
  );

  it("blocks non-https, credentials, localhost and private literals", async () => {
    for (const u of [
      "http://example.com",
      "ftp://example.com",
      "https://user:pw@example.com",
      "https://localhost/x",
      "https://foo.localhost/x",
      "https://127.0.0.1/",
      "https://[::1]/",
      "https://169.254.169.254/latest/meta-data",
      "not a url",
    ]) {
      await expect(assertPublicHttps(u)).rejects.toBeInstanceOf(BlockedUrlError);
    }
  });
});

describe("htmlToText", () => {
  it("drops scripts/styles and keeps visible text and title", () => {
    const { title, text } = htmlToText(
      "<html><head><title>My &amp; Docs</title><style>.a{}</style></head><body><script>var x=1</script><h1>Hello</h1><p>World&nbsp;text</p></body></html>",
    );
    expect(title).toBe("My & Docs");
    expect(text).toContain("Hello");
    expect(text).toContain("World text");
    expect(text).not.toContain("var x");
    expect(text).not.toContain(".a{}");
  });

  it("decodes hex, decimal and named entities (regression: GitHub docs use &#x27;)", () => {
    const { text } = htmlToText("<p>If you haven&#x27;t created an app, it&#39;s &rsquo;ok&rsquo; &mdash; 5 &lt; 6 &#8212; fine</p>");
    expect(text).toContain("haven't");
    expect(text).toContain("it's");
    expect(text).toContain("5 < 6");
    expect(quoteInText("If you haven't created an app", text)).toBe(true);
  });

  it("decodes in a single pass and leaves unknown entities alone", () => {
    const { text } = htmlToText("<p>&amp;lt; &bogus; &#xZZ;</p>");
    expect(text).toContain("&lt;");
    expect(text).toContain("&bogus;");
  });
});

describe("quotes survive markdown links and inline html", () => {
  const md = 'In the left sidebar, click <svg viewBox="0 0 16 16"><path d="M1 2z"></path></svg> **Developer settings**. Note that [OAuth RFC](https://www.rfc-editor.org/rfc/rfc8252) recommends not to use `localhost`, but instead to use 127.0.0.1.';
  it("matches a plain quote against text containing svg icons and link syntax", () => {
    expect(quoteInText("In the left sidebar, click Developer settings", md)).toBe(true);
    expect(quoteInText("OAuth RFC recommends not to use localhost, but instead to use 127.0.0.1", md)).toBe(true);
  });
  it("also matches a quote that includes the link syntax itself", () => {
    expect(quoteInText("Note that [OAuth RFC](https://www.rfc-editor.org/rfc/rfc8252) recommends not to use localhost", md)).toBe(true);
  });
  it("still rejects a quote that is not there", () => {
    expect(quoteInText("OAuth RFC recommends always using localhost for desktop apps", md)).toBe(false);
  });
  it("keeps angle-bracket placeholders matchable", () => {
    expect(quoteInText("Bot scopes should be added as scope=<bot_scope>, and user scopes", "Bot scopes should be added as `scope=<bot_scope>`, and user scopes should be added as `user_scope=<user_scope>`.")).toBe(true);
  });
});
