import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
const DESCRIPTION = "How hard is it to set up and get approval for a provider OAuth app? Look up an app and get a guide where every claim shows its source.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "OAuth App Guides", template: "%s | OAuth Guides" },
  description: DESCRIPTION,
  openGraph: { type: "website", siteName: "OAuth Guides", title: "OAuth App Guides", description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: "OAuth App Guides", description: DESCRIPTION },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <div className="site-header-inner">
            <Link href="/" className="brand">
              <span className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 6.5 5 9.5 10 3" />
                </svg>
              </span>
              OAuth Guides
            </Link>
            <nav className="nav" aria-label="Main">
              <Link href="/#guides" className="nav-link">
                Guides
              </Link>
              <Link href="/verification" className="nav-link">
                How we verify
              </Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
