import type { Metadata } from "next";
import Link from "next/link";
import { Source } from "@/components/Claims";
import { formatDate } from "@/lib/present";
import { loadResearch, type Baseline } from "@/lib/research";

export const metadata: Metadata = {
  title: "How we verify",
  description: "What we checked, what a plain AI answer gets wrong, and what we got wrong ourselves.",
};

const hostOf = (u: string) => {
  if (u.startsWith("/")) return "our test log";
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
};
const pct = (n: number, d: number) => (d === 0 ? "0%" : `${Math.round((n / d) * 100)}%`);

function Bar({ b }: { b: Baseline[number]["baseline"] }) {
  const total = b.supported + b.partial + b.contradicted + b.notAddressed || 1;
  const w = (n: number) => `${(n / total) * 100}%`;
  return (
    <>
      <div className="bar" role="img" aria-label={`${b.supported} confirmed, ${b.partial} partly confirmed, ${b.contradicted} contradicted, ${b.notAddressed} could not be confirmed`}>
        <i className="seg-supported" style={{ width: w(b.supported) }} />
        <i className="seg-partial" style={{ width: w(b.partial) }} />
        <i className="seg-contradicted" style={{ width: w(b.contradicted) }} />
        <i className="seg-none" style={{ width: w(b.notAddressed) }} />
      </div>
      <p className="bar-legend">
        <span>
          <b>{b.supported}</b> confirmed
        </span>
        <span>
          <b>{b.partial}</b> partly
        </span>
        <span>
          <b>{b.contradicted}</b> contradicted
        </span>
        <span>
          <b>{b.notAddressed}</b> can&apos;t confirm
        </span>
      </p>
    </>
  );
}

export default async function VerificationPage() {
  const { audit, baseline, corrections } = await loadResearch();

  const claims = audit.guides.reduce((a, g) => a + g.claims, 0);
  const evidence = audit.guides.reduce((a, g) => a + g.evidenceItems, 0);
  const found = audit.guides.reduce((a, g) => a + g.quotesFoundOnPage, 0);
  const checked = audit.guides.reduce((a, g) => a + g.judge.checked, 0);
  const supportedByJudge = audit.guides.reduce((a, g) => a + (g.judge.checked - g.judge.notSupported - g.judge.partlySupported), 0);

  const totals = baseline.reduce(
    (t, a) => ({
      n: t.n + a.baseline.claims.length,
      supported: t.supported + a.baseline.supported,
      partial: t.partial + a.baseline.partial,
      contradicted: t.contradicted + a.baseline.contradicted,
      none: t.none + a.baseline.notAddressed,
    }),
    { n: 0, supported: 0, partial: 0, contradicted: 0, none: 0 },
  );

  return (
    <main className="page">
      <div className="container">
        <Link href="/" className="back">
          ← All guides
        </Link>

        <section className="hero enter" style={{ paddingTop: 32 }}>
          <p className="eyebrow">How we verify</p>
          <h1 className="display">Every claim shows its work.</h1>
          <p className="lede">
            A guide is only useful if you can tell which parts to trust. Here is what we check, what a plain AI answer gets wrong on the same questions, and
            what we got wrong ourselves along the way.
          </p>
        </section>

        <h2 className="block-title" style={{ marginTop: 24 }}>
          Three checks on every claim
        </h2>
        <div className="checks">
          <div className="check">
            <span className="check-n">1</span>
            <h3>Is the quote on the page?</h3>
            <p>Every claim carries a word-for-word quote and a link. Code, not the model, fetches the page and checks the quote is really there. If it isn&apos;t, the claim is shown as unverified.</p>
          </div>
          <div className="check">
            <span className="check-n">2</span>
            <h3>Does the quote say that?</h3>
            <p>A quote can exist and still not support the claim. A second, separate model call sees only the claim and the quote and rules on whether it supports it.</p>
          </div>
          <div className="check">
            <span className="check-n">3</span>
            <h3>Is it labeled honestly?</h3>
            <p>Estimates say they are estimates. Absences are labeled as inferred. When sources disagree, we show both. What we couldn&apos;t verify gets its own section.</p>
          </div>
        </div>

        {audit.guides.length > 0 && (
          <>
            <div className="stats">
              <div className="stat">
                <p className="stat-num">{claims}</p>
                <p className="stat-label">claims across {audit.guides.length} curated guides</p>
              </div>
              <div className="stat">
                <p className="stat-num">{pct(found, evidence)}</p>
                <p className="stat-label">
                  of {evidence} quotes found on the live pages when re-fetched {formatDate(audit.generatedAt)}
                </p>
              </div>
              <div className="stat">
                <p className="stat-num">{pct(supportedByJudge, checked)}</p>
                <p className="stat-label">of {checked} quoted claims fully supported by their quote, per the second check</p>
              </div>
            </div>
          </>
        )}

        <h2 className="block-title">A plain answer, checked</h2>
        <p className="prose">
          We asked the same model, with no sources, how hard it is to get an OAuth app approved for each app, then checked every specific claim in its answer
          against the official pages. <strong>Most claims could not be confirmed either way</strong>, and a plain answer gives no hint which ones. A few were
          wrong.
        </p>

        {totals.n > 0 && (
          <div className="stats">
            <div className="stat">
              <p className="stat-num">{totals.supported}</p>
              <p className="stat-label">of {totals.n} claims confirmed by an official page</p>
            </div>
            <div className="stat">
              <p className="stat-num">{totals.contradicted}</p>
              <p className="stat-label">contradicted by an official page</p>
            </div>
            <div className="stat">
              <p className="stat-num">{totals.none + totals.partial}</p>
              <p className="stat-label">stated confidently, but the pages we read don&apos;t confirm them</p>
            </div>
          </div>
        )}

        <div className="cmp">
          {baseline.map((a) => {
            const wrong = a.baseline.claims.filter((c) => c.verdict === "contradicted" || (c.verdict === "partial" && c.handReviewed));
            return (
              <div key={a.slug} className="cmp-card">
                <div className="cmp-head">
                  <h3>{a.appName}</h3>
                  <span>
                    This guide: {a.pipeline.withQuote} of {a.pipeline.claims} claims quoted, {a.pipeline.gapsListed} gaps listed
                  </span>
                </div>
                <Bar b={a.baseline} />
                {wrong.map((c, i) => (
                  <div key={i} className="finding">
                    <p className="pair">The plain answer said</p>
                    <p>
                      <span className={`tag ${c.verdict === "contradicted" ? "tag-corrected" : "tag-partial"}`}>{c.verdict === "contradicted" ? "Contradicted" : "Partly right"}</span>
                      {c.claim}
                    </p>
                    <p className="pair" style={{ marginTop: 10 }}>
                      The official page says
                    </p>
                    <p className="muted">“{c.quote}”</p>
                    <p className="fineprint">
                      <a href={c.url} target="_blank" rel="noopener noreferrer">
                        {hostOf(c.url)}
                      </a>
                      {c.handReviewed ? " · hand-reviewed" : " · hand-reviewed contradiction"}
                      {c.note ? `. ${c.note}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <p className="fineprint" style={{ marginTop: 16 }}>
          &ldquo;Can&apos;t confirm&rdquo; means the pages we read don&apos;t say, not that the claim is false. Some may be true and documented elsewhere. The point
          is that you can&apos;t tell from an unsourced answer. This is one run of one model, and the checker is itself a model. We hand-reviewed every
          contradiction, and a person also read the unconfirmed claims and added the ones the checker missed (marked as hand-reviewed).
        </p>

        <h2 className="block-title">What we got wrong</h2>
        <p className="prose" style={{ marginBottom: 24 }}>
          A log of claims we checked, including our own. Corrections are the point: they show where the checks earn their keep.
        </p>
        <div className="log">
          {corrections.map((c) => (
            <article key={c.id} className="log-item">
              <div className="log-meta">
                <span className={`tag tag-${c.outcome}`} style={{ marginLeft: 0 }}>
                  {c.outcome === "confirmed" ? "Confirmed" : c.outcome === "corrected" ? "Corrected" : c.outcome === "conflicting" ? "Sources conflict" : "Unverifiable"}
                </span>
                <span>
                  {c.app} · {c.area}
                </span>
              </div>
              <p className="log-claim">{c.claim}</p>
              <p className="log-what">{c.what}</p>
              {c.quote && c.url && (
                <Source
                  claim={{
                    text: c.claim,
                    confidence: "docs",
                    evidence: [{ url: c.url, quote: c.quote, fetchedAt: audit.generatedAt || new Date(0).toISOString() }],
                  }}
                />
              )}
            </article>
          ))}
        </div>

        <h2 className="block-title">Limits</h2>
        <ul className="limits">
          <li>The second check is a model, so it can be wrong and it varies from run to run. We use it as a reviewer, not a judge, and keep humans in the loop for anything marked as hand-reviewed.</li>
          <li>Quotes prove a claim is on a page, not that the page is current. Every guide shows the date it was fetched.</li>
          <li>Guides generated live have not been reviewed by a person. The seed guides were written from the pages and then re-checked by script.</li>
          <li>Provider approval times are mostly unpublished. We say &ldquo;not stated&rdquo; instead of guessing, which is less satisfying and more honest.</li>
          <li>We used a free-tier model. Quality and availability vary, so the app tries several models in order.</li>
        </ul>
      </div>
    </main>
  );
}
