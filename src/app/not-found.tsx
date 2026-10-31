import Link from "next/link";

export const metadata = { title: "Guide not found", robots: { index: false } };

export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="page">
      <div className="container">
        <section className="hero">
          <p className="eyebrow">404</p>
          <h1 className="title">We couldn&apos;t find that page.</h1>
          <p className="lede">The guide may never have existed, or a generated one expired after a week. You can look the app up and generate it again in about 15 seconds.</p>
          <p style={{ marginTop: 28 }}>
            <Link href="/#search" className="btn btn-primary btn-link">
              Search for an app
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
