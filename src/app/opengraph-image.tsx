import { ImageResponse } from "next/og";

export const alt = "OAuth App Guides: know the path before you start";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Share preview for the site and for every guide that does not define its own image.
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: "linear-gradient(135deg, #0b0b0f 0%, #10213f 100%)",
          color: "#f5f5f7",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: "linear-gradient(135deg,#5ac8fa,#0071e3 55%,#5e5ce6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {/* drawn, not typed: a "✓" character makes the renderer download a font at build time */}
            <svg width="30" height="30" viewBox="0 0 30 30">
              <path d="M6 16 13 23 25 8" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ fontSize: 34, fontWeight: 600 }}>OAuth Guides</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 86, fontWeight: 700, lineHeight: 1.05, letterSpacing: -3 }}>Know the path before you start.</div>
          <div style={{ fontSize: 34, color: "#a1a1a6", lineHeight: 1.3 }}>How hard is the OAuth app, and how long is approval? Every claim shows its source.</div>
        </div>
      </div>
    ),
    size,
  );
}
