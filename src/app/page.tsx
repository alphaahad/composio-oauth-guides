import Link from "next/link";
import { Badge } from "@/components/Claims";
import { SearchBox } from "@/components/SearchBox";
import { VERDICT_LABEL, VERDICT_TONE } from "@/lib/present";
import type { Confidence } from "@/lib/schema";
import { listSeeds } from "@/lib/store";

const LEGEND: Confidence[] = ["tested", "docs", "reported", "inferred", "unknown"];

export default async function Home() {
  const seeds = await listSeeds();
  return (
    <main className="wrap">
      <h1>Will this OAuth app take an hour or a month?</h1>
      <p className="muted">
        Look up an app to see whether you need your own OAuth app, how much work it is, how long approval may take, and where an agent can help
        versus where you take over. Every claim shows its source, or says it is unverified.
      </p>

      <SearchBox />

      <h2>Ready-made guides</h2>
      {seeds.length === 0 ? (
        <p className="muted">No curated guides yet. Search for any app above to generate one live.</p>
      ) : (
        <div className="grid">
          {seeds.map((g) => (
            <Link key={g.slug} href={`/g/${g.slug}`} className="card">
              <h3>{g.appName}</h3>
              <span className={`chip chip-${VERDICT_TONE[g.verdict.value]}`}>{VERDICT_LABEL[g.verdict.value]}</span>
              <p style={{ marginTop: "0.5rem" }}>{g.summary}</p>
            </Link>
          ))}
        </div>
      )}

      <h2>How to read the labels</h2>
      <div className="legend">
        {LEGEND.map((l) => (
          <Badge key={l} level={l} />
        ))}
      </div>
      <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
        Guides generated live are not human-verified. Quotes are checked by code against the fetched pages; anything that fails is marked unverified.
      </p>
    </main>
  );
}
