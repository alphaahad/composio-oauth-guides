import { NextResponse, type NextRequest } from "next/server";
import { guideExists, isValidSlug } from "@/lib/storage";

/**
 * Guide pages stream, and a streamed response has already committed to 200. So the checks that must produce a real
 * status code run here, before the page renders: uppercase slugs redirect to the canonical lowercase one, and a slug
 * that does not exist is answered with the site's 404 page and a 404 status.
 */
export async function proxy(req: NextRequest) {
  const slug = decodeSlug(req.nextUrl.pathname.slice("/g/".length));
  const lower = slug.toLowerCase();
  if (slug !== lower && isValidSlug(lower)) {
    const url = req.nextUrl.clone();
    url.pathname = `/g/${lower}`;
    return NextResponse.redirect(url, 308);
  }
  let exists = false;
  try {
    exists = await guideExists(slug);
  } catch {
    return NextResponse.next(); // storage trouble: let the page decide and show its error state
  }
  return exists ? NextResponse.next() : NextResponse.rewrite(new URL("/guide-not-found", req.url), { status: 404 });
}

function decodeSlug(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export const config = { matcher: "/g/:slug" };
