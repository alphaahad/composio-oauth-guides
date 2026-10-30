import Link from "next/link";
import { SearchBox } from "@/components/SearchBox";
import { VERDICT_HEADLINE, VERDICT_TONE } from "@/lib/present";
import { listSeeds } from "@/lib/store";

const LEGEND: [string, string][] = [
  ["Source", "A quote copied from the provider's own docs, checked by code against the page it came from."],
  ["Our estimate", "Our judgment, such as effort in hours. Not stated by any source."],
  ["Community source", "A quote from a third-party page. Useful, but not official."],
  ["Unverified", "Nothing we could check supports this. Shown as a gap on purpose."],
];

export default async function Home() {
  const seeds = await listSeeds();
  return (
    <main className="page">
      <div className="container">
        <section className="hero enter">
          <p className="eyebrow">OAuth app setup, decoded</p>
          <h1 className="display">Know the path before you start.</h1>
          <p className="lede">
            Search any app to see whether you need your own OAuth app, how long approval may take, and where an agent can help. Every claim cites its
            source, or says it&apos;s unverified.
          </p>
          <SearchBox />
        </section>

        <h2 className="block-title" id="guides">
          Ready-made guides
        </h2>
        <div className="grid">
          {seeds.map((g) => (
            <Link key={g.slug} href={`/g/${g.slug}`} className="card">
              <h3>{g.appName}</h3>
              <span className={`status tone-${VERDICT_TONE[g.verdict.value]}`}>
                <span className="dot" aria-hidden="true" />
                {VERDICT_HEADLINE[g.verdict.value]}
              </span>
              <p>{g.summary}</p>
              <span className="card-foot">View guide</span>
            </Link>
          ))}
          <a href="#search" className="card card-ghost">
            <h3>Another app?</h3>
            <p>Search above and an agent reads the provider&apos;s docs and writes a guide in about 15 seconds.</p>
            <span className="card-foot">Generate one</span>
          </a>
        </div>

        <h2 className="block-title">How to read a guide</h2>
        <dl className="legend">
          {LEGEND.map(([term, def]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{def}</dd>
            </div>
          ))}
        </dl>
        <p className="fineprint" style={{ marginTop: 24 }}>
          Guides generated live are not human-verified. Anything marked Unverified is a gap, not a guess.
        </p>
      </div>
    </main>
  );
}
