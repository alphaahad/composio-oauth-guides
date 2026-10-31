"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Step = { stage: string; status: "start" | "done" | "warn"; message: string };

const EXAMPLES = ["Linear", "Typeform", "Strava", "X"]; // apps without a curated guide, so these show live generation

function Icon({ status }: { status: Step["status"] }) {
  if (status === "start") return <span className="spinner" aria-hidden="true" />;
  return status === "warn" ? (
    <svg className="tl-warn" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="10" cy="10" r="8" />
      <path d="M10 6v4.5M10 13.5v.01" />
    </svg>
  ) : (
    <svg className="tl-done" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="10" r="8" />
      <path d="m6.5 10.2 2.5 2.5 4.5-5" />
    </svg>
  );
}

export function SearchBox() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const stallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stalled = useRef(false);

  // A live guide normally takes about 15 seconds. If nothing at all arrives for this long, the connection has probably
  // been dropped (a server restart, a network blip), and waiting longer only looks like a hang.
  const armWatchdog = () => {
    if (stallTimer.current) clearTimeout(stallTimer.current);
    stallTimer.current = setTimeout(() => {
      stalled.current = true;
      abort.current?.abort();
    }, 45_000);
  };
  const disarmWatchdog = () => {
    if (stallTimer.current) clearTimeout(stallTimer.current);
    stallTimer.current = null;
  };

  // A step that starts and later finishes should become one line, not two.
  function push(ev: Step) {
    setSteps((prev) => {
      if (ev.status !== "start") {
        const i = prev.map((s) => s.stage + s.status).lastIndexOf(ev.stage + "start");
        if (i !== -1) return prev.map((s, j) => (j === i ? ev : s));
      }
      return [...prev, ev];
    });
  }

  async function run(q: string) {
    if (busy || !q.trim()) return;
    setBusy(true);
    setError(null);
    setSteps([]);
    abort.current = new AbortController();
    stalled.current = false;
    armWatchdog();

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q }),
        signal: abort.current.signal,
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        armWatchdog();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const f of frames) {
          const line = f.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "stage") push(ev as Step);
          else if (ev.type === "ready") {
            router.push(`/g/${ev.slug}`);
            return;
          } else if (ev.type === "error") throw new Error(ev.message);
        }
      }
      throw new Error("The connection closed before the guide was ready. Please try again.");
    } catch (err) {
      if (stalled.current) setError("This is taking longer than expected, so we stopped waiting. Please try again.");
      else if ((err as Error).name !== "AbortError") setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    } finally {
      disarmWatchdog();
    }
  }

  return (
    <div id="search">
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          run(query);
        }}
      >
        <label htmlFor="q" className="sr-only">
          App name or website
        </label>
        <input
          id="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search any app, e.g. Slack or developer.atlassian.com"
          maxLength={100}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={busy}
        />
        <button className="btn btn-primary" disabled={busy || !query.trim()}>
          {busy ? "Working" : "Get guide"}
        </button>
      </form>

      <div className="chips">
        <span>Try</span>
        {EXAMPLES.map((e) => (
          <button
            key={e}
            type="button"
            className="chip-btn"
            disabled={busy}
            onClick={() => {
              setQuery(e);
              run(e);
            }}
          >
            {e}
          </button>
        ))}
      </div>

      <div className="progress" aria-live="polite">
        {steps.length > 0 && (
          <ol className="timeline">
            {steps.map((s, i) => (
              <li key={`${s.stage}-${i}`} className={`tl-item${s.stage === "fetch" && s.status === "done" ? " sub" : ""}`}>
                <span className="tl-icon">
                  <Icon status={s.status} />
                </span>
                <span>{s.message}</span>
              </li>
            ))}
          </ol>
        )}
        {busy && (
          <button type="button" className="btn" style={{ marginTop: 12 }} onClick={() => abort.current?.abort()}>
            Cancel
          </button>
        )}
        {error && (
          <div role="alert" className="search-error">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
