import { CONFIDENCE_HELP, CONFIDENCE_LABEL } from "@/lib/present";
import type { Claim } from "@/lib/schema";

function host(u: string) {
  if (u.startsWith("/")) return "our test log"; // evidence we produced ourselves, served from this site
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

/**
 * Sourced claims are the default and stay quiet. Only deviations from "a quote from the provider's docs"
 * get a label, so the labels that matter are the ones you notice.
 */
export function Tag({ claim }: { claim: Claim }) {
  const c = claim.confidence;
  return (
    <>
      {c !== "docs" && (
        <span className={`tag tag-${c}`} title={CONFIDENCE_HELP[c]}>
          {c === "reported" ? "Community source" : c === "inferred" ? "Our estimate" : CONFIDENCE_LABEL[c]}
        </span>
      )}
      {claim.support === "partial" && (
        <span className="tag tag-partial" title="The quote supports only part of this claim, or a weaker version of it.">
          Partly supported
        </span>
      )}
    </>
  );
}

/** The verbatim evidence behind a claim, one tap away. */
export function Source({ claim }: { claim: Claim }) {
  if (claim.evidence.length === 0) return null;
  return (
    <details className="src">
      <summary>{claim.evidence.length > 1 ? `${claim.evidence.length} sources` : "Source"}</summary>
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
  );
}

export function ClaimRow({ claim }: { claim: Claim }) {
  return (
    <div className="claim">
      <p className="claim-text">
        {claim.text}
        <Tag claim={claim} />
      </p>
      <Source claim={claim} />
    </div>
  );
}

export function ClaimList({ claims, steps = false, empty = "Nothing found in the sources." }: { claims: Claim[]; steps?: boolean; empty?: string }) {
  if (claims.length === 0) return <p className="empty">{empty}</p>;
  const Tagname = steps ? "ol" : "ul";
  return (
    <Tagname className={`claims${steps ? " steps" : ""}`}>
      {claims.map((c, i) => (
        <li key={i}>
          <ClaimRow claim={c} />
        </li>
      ))}
    </Tagname>
  );
}
