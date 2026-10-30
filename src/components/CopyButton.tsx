"use client";

import { useState } from "react";

export function CopyButton({ text, label, getUrl = false }: { text: string; label: string; getUrl?: boolean }) {
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(getUrl ? window.location.href : text);
      setState("done");
    } catch {
      setState("fail");
    }
    setTimeout(() => setState("idle"), 1800);
  }
  return (
    <button type="button" className="btn" onClick={copy} aria-live="polite">
      {state === "done" ? "Copied" : state === "fail" ? "Couldn't copy" : label}
    </button>
  );
}
