import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OAuth App Guides",
  description: "How hard is it to set up and get approval for a provider OAuth app? Look up an app and get an evidence-backed guide.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
