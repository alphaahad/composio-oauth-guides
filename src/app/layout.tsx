import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "OAuth App Guides",
  description: "How hard is it to set up and get approval for a provider OAuth app? Look up an app and get an evidence-backed guide.",
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
            <nav className="nav">
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
