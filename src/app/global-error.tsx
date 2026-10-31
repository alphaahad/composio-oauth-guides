"use client";

// Last resort: renders only if the root layout itself fails, so it carries its own minimal markup and styles.
export default function GlobalError() {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b0b0f", color: "#f5f5f7", fontFamily: "-apple-system, system-ui, sans-serif" }}>
        <main style={{ maxWidth: 520, padding: 24 }}>
          <h1 style={{ fontSize: 32, margin: "0 0 12px" }}>Something went wrong.</h1>
          <p style={{ color: "#a1a1a6", lineHeight: 1.5 }}>The site hit an unexpected problem. It is usually temporary.</p>
          <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 16, padding: "10px 20px", borderRadius: 999, border: 0, background: "#2997ff", color: "#000", fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
