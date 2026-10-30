import { CONFIDENCE_HELP, CONFIDENCE_LABEL } from "@/lib/present";
import type { Claim, Confidence } from "@/lib/schema";

export function Badge({ level }: { level: Confidence }) {
  return (
    <span className={`badge badge-${level}`} title={CONFIDENCE_HELP[level]}>
      {CONFIDENCE_LABEL[level]}
    </span>
  );
}

function host(u: string) {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
}

/** One claim: text, a trust badge, and the verbatim evidence behind it. */
export function ClaimView({ claim }: { claim: Claim }) {
  return (
    <div className="claim">
      <p>
        {claim.text} <Badge level={claim.confidence} />
        {claim.support === "partial" && (
          <span className="badge badge-reported" title="The quote supports only part of this claim, or a weaker version of it.">
            Partly supported
          </span>
        )}
      </p>
      {claim.evidence.length > 0 && (
        <details className="evidence">
          <summary>Evidence</summary>
          {claim.evidence.map((e, i) => (
            <blockquote key={i}>
              “{e.quote}”
              <footer>
                <a href={e.url} target="_blank" rel="noopener noreferrer">
                  {host(e.url)}
                </a>
                {" · fetched "}
                {e.fetchedAt.slice(0, 10)}
              </footer>
            </blockquote>
          ))}
        </details>
      )}
    </div>
  );
}

export function ClaimList({ claims, ordered = false }: { claims: Claim[]; ordered?: boolean }) {
  if (claims.length === 0) return <p className="muted">Nothing found in the sources.</p>;
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className="claims">
      {claims.map((c, i) => (
        <li key={i}>
          <ClaimView claim={c} />
        </li>
      ))}
    </Tag>
  );
}
