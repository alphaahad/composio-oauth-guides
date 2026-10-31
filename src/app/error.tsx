"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    console.error(error);
  }, [error]);
  // reset() alone only re-renders on the client; the failure was on the server, so fetch the page again too.
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <main id="main" tabIndex={-1} className="page">
      <div className="container">
        <section className="hero">
          <p className="eyebrow">Something went wrong</p>
          <h1 className="title">This page couldn&apos;t load.</h1>
          <p className="lede">It is on our side, not yours, and it is usually temporary. Try again, or go back to the guides.</p>
          <p style={{ marginTop: 28, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary" onClick={retry}>
              Try again
            </button>
            <Link href="/" className="btn btn-link">
              All guides
            </Link>
          </p>
          {error.digest && <p className="fineprint">Reference: {error.digest}</p>}
        </section>
      </div>
    </main>
  );
}
