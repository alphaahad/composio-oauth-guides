import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClaimList, Source, Tag } from "@/components/Claims";
import { CopyButton } from "@/components/CopyButton";
import { formatDate, guideToMarkdown, RISK_LEVEL, splitEffort, VERDICT_HEADLINE, VERDICT_TONE } from "@/lib/present";
import type { Guide } from "@/lib/schema";
import { getGuide } from "@/lib/store";

const SURFACE_LABEL = {
  api: "Creatable through an API",
  cli: "Scriptable with a CLI",
  manifest: "Manifest-driven, with a human step remaining",
  "ui-only": "Web dashboard only",
  gated: "Behind a human or provider gate",
  unknown: "Not stated in the sources we read",
} as const;

// Live guides are created at request time, so params and the store read sit behind Suspense
// (Cache Components requires runtime data to be streamed, not blocking the static shell).
export default function GuidePage({ params }: PageProps<"/g/[slug]">) {
  return (
    <main className="page">
      <div className="container">
        <Suspense
          fallback={
            <div className="guide-head">
              <p className="eyebrow">Loading guide</p>
            </div>
          }
        >
          {params.then(({ slug }) => (
            <GuideContent slug={slug} />
          ))}
        </Suspense>
      </div>
    </main>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="section">
      <h2>
        {title}
        {hint && <small>{hint}</small>}
      </h2>
      <div>{children}</div>
    </section>
  );
}

const Icon = {
  check: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3.5 8.3 3 3 6-6.6" />
    </svg>
  ),
  arrow: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8h9.5M8.5 4l4 4-4 4" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M8 7.2v4M8 4.8v.01" />
    </svg>
  ),
};

function ComposioNote({ g }: { g: Guide }) {
  const m = g.composio.managed;
  const title = m === "yes" ? "Composio manages this OAuth app" : m === "no" ? "You bring your own OAuth app" : "Not in Composio's OAuth catalog";
  return (
    <div className={`composio composio-${m}`}>
      <span className="composio-icon">{m === "yes" ? Icon.check : m === "no" ? Icon.arrow : Icon.info}</span>
      <div>
        <strong>{title}</strong>
        <p>{g.composio.note}</p>
      </div>
    </div>
  );
}

async function GuideContent({ slug }: { slug: string }) {
  const g = await getGuide(slug);
  if (!g) notFound();

  const tone = VERDICT_TONE[g.verdict.value];
  const effort = splitEffort(g.effort.text);
  const waitStated = g.wait.confidence !== "unknown";
  const risk = g.blockerRisk.value;
  const okSources = g.sources.filter((s) => s.status === "ok");
  const failedSources = g.sources.filter((s) => s.status !== "ok");
  const markdown = guideToMarkdown(g);

  return (
    <>
      <title>{`${g.appName}: OAuth app setup`}</title>
      <Link href="/" className="back">
        ← All guides
      </Link>

      <div className="enter">
        <header className="guide-head">
          <p className="eyebrow">OAuth app setup</p>
          <h1 className="title">{g.appName}</h1>
          <div className="meta">
            <span className={`pill ${g.humanReviewed ? "pill-good" : "pill-warn"}`}>
              <span className="dot" aria-hidden="true" />
              {g.humanReviewed ? "Reviewed by a human" : "Agent-generated"}
            </span>
            <span>{formatDate(g.generatedAt)}</span>
            <div className="meta-actions">
              <CopyButton label="Copy as Markdown" text={markdown} />
              <CopyButton label="Copy link" text="" getUrl />
            </div>
          </div>
          {!g.humanReviewed && (
            <p className="fineprint">
              The summary is written by the agent. The claims below it are the checked part: each quote is matched by code against the pages we fetched. Open
              Source under any line to read the exact words.
            </p>
          )}
        </header>

        <section className="answer" aria-labelledby="answer-title">
          <span className={`status tone-${tone}`}>
            <span className="dot" aria-hidden="true" />
            The short answer
          </span>
          <h2 className="answer-title" id="answer-title">
            {VERDICT_HEADLINE[g.verdict.value]}
          </h2>
          <p className="answer-body">{g.summary}</p>
          <Source claim={g.verdict.claim} />
          <ComposioNote g={g} />
        </section>

        <section className="tiles" aria-label="At a glance">
          <div className="tile">
            <p className="eyebrow">Effort</p>
            <p className={`tile-value${effort.big ? "" : " small none"}`}>{effort.big ?? "Unknown"}</p>
            {effort.note && <p className="tile-note">{effort.note}</p>}
            <div className="tile-foot">
              <Tag claim={g.effort} />
            </div>
          </div>

          <div className="tile">
            <p className="eyebrow">Approval wait</p>
            {waitStated ? (
              <p className="tile-value small">{g.wait.text}</p>
            ) : (
              <>
                <p className="tile-value none">Not stated</p>
                <p className="tile-note">No source we read gives a review timeline.</p>
              </>
            )}
            <div className="tile-foot">
              {waitStated && <Tag claim={g.wait} />}
              <Source claim={g.wait} />
            </div>
          </div>

          <div className="tile">
            <p className="eyebrow">Blocker risk</p>
            <p className={`tile-value${risk === "unknown" ? " none" : ""}`}>{risk.charAt(0).toUpperCase() + risk.slice(1)}</p>
            <div className={`meter m${RISK_LEVEL[risk]}`} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p className="tile-note">Our judgment, based on the requirements found.</p>
            <div className="tile-foot">
              <Tag claim={g.blockerRisk.claim} />
            </div>
          </div>
        </section>

        <Section title="What to do" hint="In order, with the source for each step.">
          <ClaimList claims={g.steps} steps empty="The pages we read don't lay out the setup steps." />
        </Section>

        {g.redirectRules.length > 0 && (
          <Section title="Redirect URIs" hint="Rules for the callback URL.">
            <ClaimList claims={g.redirectRules} />
          </Section>
        )}

        {g.requirements.length > 0 && (
          <Section title="Requirements">
            <ClaimList claims={g.requirements} />
          </Section>
        )}

        {g.scopeTiers.length > 0 && (
          <Section title="Scopes" hint="Different scopes can mean different approval paths.">
            <ClaimList claims={g.scopeTiers} />
          </Section>
        )}

        {g.gotchas.length > 0 && (
          <Section title="Watch out for">
            <ClaimList claims={g.gotchas} />
          </Section>
        )}

        <Section title="Agent and you" hint="What can be automated, and where a person takes over.">
          <div className="surface-note">
            <b>How the app gets created:</b> {SURFACE_LABEL[g.automation.surface]}
            {g.automation.surfaceClaim && <Source claim={g.automation.surfaceClaim} />}
          </div>
          <div className="two">
            <div className="panel">
              <h3>An agent can</h3>
              <ClaimList claims={g.automation.agentCan} empty="No automatable step is documented." />
            </div>
            <div className="panel">
              <h3>You take over for</h3>
              <ClaimList claims={g.automation.youMust} empty="No human-only step is documented." />
            </div>
          </div>
        </Section>

        {(g.blocked.contacts.length > 0 || g.blocked.usualRejections.length > 0 || g.blocked.emailTemplate) && (
          <Section title="If you get blocked" hint="Who to ask, and what usually goes wrong.">
            <div className="two">
              <div className="panel">
                <h3>Who to contact</h3>
                <ClaimList claims={g.blocked.contacts} empty="No official contact found in the sources." />
              </div>
              <div className="panel">
                <h3>Why submissions fail</h3>
                <ClaimList claims={g.blocked.usualRejections} empty="No rejection reasons are documented." />
              </div>
            </div>
            {g.blocked.emailTemplate && (
              <>
                <p className="subhead" style={{ marginTop: 24 }}>
                  Email template
                </p>
                <pre className="template">{g.blocked.emailTemplate}</pre>
                <CopyButton label="Copy template" text={g.blocked.emailTemplate} />
              </>
            )}
          </Section>
        )}

        <Section title="What we couldn't verify" hint="Gaps, listed on purpose.">
          {g.gaps.length === 0 ? (
            <p className="empty">No gaps recorded.</p>
          ) : (
            <div className="note-card">
              <ul>
                {g.gaps.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        <Section title="How we checked" hint="Pages read and endpoints probed.">
          <p className="subhead">Pages we read</p>
          <table className="plain">
            <tbody>
              {okSources.map((s, i) => (
                <tr key={i}>
                  <th scope="row">
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.title || s.url}
                    </a>
                  </th>
                  <td>
                    {formatDate(s.fetchedAt)}
                    {s.note ? ` · ${s.note}` : ""}
                  </td>
                </tr>
              ))}
              {failedSources.map((s, i) => (
                <tr key={`f${i}`}>
                  <th scope="row">{s.url}</th>
                  <td>Couldn&apos;t read: {s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {g.probes.length > 0 && (
            <>
              <p className="subhead">Endpoints we probed, no credentials</p>
              <table className="plain">
                <tbody>
                  {g.probes.map((p, i) => (
                    <tr key={i}>
                      <th scope="row">{p.name}</th>
                      <td>
                        <code>{p.url}</code>
                        <br />
                        {p.ok ? "Found. " : "Not found. "}
                        {p.finding}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Section>
      </div>
    </>
  );
}
