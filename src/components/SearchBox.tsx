"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Step = { stage: string; status: "start" | "done" | "warn"; message: string };

export function SearchBox() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !query.trim()) return;
    setBusy(true);
    setError(null);
    setSteps([]);
    abort.current = new AbortController();

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
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
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const f of frames) {
          const line = f.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "stage") setSteps((s) => [...s, ev as Step]);
          else if (ev.type === "ready") {
            router.push(`/g/${ev.slug}`);
            return;
          } else if (ev.type === "error") throw new Error(ev.message);
        }
      }
      throw new Error("The connection closed before the guide was ready. Please try again.");
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="search">
        <label htmlFor="q" className="sr-only">
          App name or website
        </label>
        <input
          id="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="App name or website, e.g. Notion or developer.atlassian.com"
          maxLength={100}
          autoComplete="off"
          disabled={busy}
        />
        <button className="btn btn-primary" disabled={busy || !query.trim()}>
          {busy ? "Working…" : "Get guide"}
        </button>
      </form>

      <div aria-live="polite" className="progress">
        {steps.map((s, i) => (
          <div key={i} className={`step step-${s.status}`}>
            <span aria-hidden="true">{s.status === "warn" ? "!" : s.status === "done" ? "✓" : "…"}</span> {s.message}
          </div>
        ))}
        {busy && steps.length > 0 && <div className="step step-start">…</div>}
        {error && (
          <div role="alert" className="step step-error">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
