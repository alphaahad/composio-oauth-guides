# QA record

A full pass over the production build (`npm run build && npm run start`) before release. Source-side issues (a provider page changing, a model's wording) are tracked on `/verification`; this file covers faults on our side.

## What was exercised

| Area | Method | Result |
| --- | --- | --- |
| Accessibility | axe-core 4.10 (WCAG 2.0/2.1/2.2 A and AA, best practice) on home, 3 curated guides, a live guide, `/verification` and the 404, in light and dark, plus 375px mobile | 0 violations |
| Keyboard | Tab order, skip link (focus lands in `<main>`), visible focus ring | Pass |
| Responsive | 375px width: no horizontal scroll on any page, 56px search input, tap targets | Pass |
| HTTP behavior | 25 routes: real 404 for unknown or invalid slugs, 308 for uppercase slugs, 405 on `GET /api/generate`, security headers, no `X-Powered-By`, `no-store` on `/api` | Pass |
| Input handling | 11 hostile or malformed inputs (schemes, IPs, credentials, markup, oversize, bad JSON, wrong types) | All rejected with a clear 400 |
| Live generation | Fresh run end to end (about 10 s), shareable link opens, listed publicly only when an official source was found | Pass |
| Cancel | Real click mid-run: one request, UI returns to idle, no restart | Pass |
| Failure states | Malformed guide file (branded error page with a reference; Try again recovers once the cause is fixed). A storage outage takes the same path but was not simulated | Pass |
| Links | Every internal link (373 links across 10 pages) and all 37 external source links | All 200 |
| Console | Fresh tab through every page type | No errors |
| Evidence | `npm run verify`: 200 guide quotes and 22 research quotes re-fetched from the live pages | All found |
| Unit tests | 197 across 11 files | Pass |

## Faults found on our side, and fixed

- A request that never finished could leave the progress card spinning forever; a watchdog, elapsed counter and a working Cancel now bound every run.
- Cancel restarted the search (one DOM button was reused as submit); distinct keys plus `preventDefault`.
- Unknown guide URLs answered `200`, and `/g/GitHub` did not redirect. Streamed responses commit their status early, so `src/proxy.ts` now decides 404 and 308 before the page renders.
- The error page's Try again only re-rendered on the client and never refetched; it now refreshes the route.
- The skip link did not move focus into the page for browsers that need a focusable target; `<main>` is now focusable.
- Missing contrast, tap-target sizes, forced-colors support and a mobile search field that rendered too short.
- Search accepted junk (`javascript:` URLs, IP addresses, markup); it now accepts only app names and public websites.
- A single corrupt saved guide hid every other guide in the recent list; one bad file is now skipped.
- Missing favicon, share image, `robots.txt`, error boundaries, page titles per guide, and security headers.

## Deployed site (Vercel, Upstash Redis)

Checked against https://composio-oauth-guides-lovat.vercel.app after each deploy.

| Area | Result |
| --- | --- |
| Routes | 200 for home, `/verification` and all six curated guides; 404 for unknown slugs and unknown pages; 308 from `/g/GitHub` to `/g/github`; `/g/%00` is refused with a 400 by Vercel's edge |
| Headers | Security headers present; `/api` is `no-store`; `GET /api/generate` is 405 |
| Live generation | Two fresh runs by `curl` (about 11 s) and one through the browser UI, ending on a working shareable link; the repeat request is served from the Redis cache |
| Persistence | A generated guide opens on later requests handled by other instances, appears in "Recently generated", and an uppercase live slug redirects |
| Rate limit | 6 counted requests per IP, then 429 with `Retry-After`, shown clearly in the UI |
| Accessibility | axe on a live guide: 0 violations, no overflow |
| Share metadata | Titles, descriptions and a 1200x630 image on the home page and on every guide |

Faults found only on the deployed site, and fixed:

- Every live-generated guide returned a 500. A slug that was not prebuilt is rendered on demand, and Next cannot prerender a fallback shell for a route that reads `params` outside `<Suspense>`. The guide body now streams inside `<Suspense>`; 404 and 308 stay real status codes because the proxy decides them first.
- The rate limiter never tripped (counters were per serverless instance). Counters now live in Redis, with an in-memory fallback if Redis is unavailable.
- Guide pages had no share image, because per-guide metadata replaced the site default.

## Known and accepted

- Under `curl`, a page whose data fails to load leaves the HTTP stream open after the error payload; browsers recover and show the error page. This is how Next.js reports a failure after streaming starts.
- The rate limit keys on the forwarded client IP, so it slows casual abuse but is not a security boundary.
