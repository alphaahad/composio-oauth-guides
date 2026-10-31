# OAuth App Guides

Before an agent can connect your users to an app, you often need your own OAuth app with that provider, and sometimes the provider has to approve it. Developers piece that path together from docs, trial and error, and emails, and the part nobody can predict is the wait.

This project answers three questions for any app, with the evidence attached:

1. **Do I need my own OAuth app at all?** (Composio may already manage one.)
2. **How much work is it, and how long could approval take?**
3. **What can an agent do for me, and where do I have to take over?**

Search an app, or open a ready-made guide. Every claim in a guide shows the exact words that support it, or says it is unverified.

## What is in it

- **Six curated guides** (GitHub, Google, Slack, LinkedIn, Shopify, Notion), written from official docs and checked by script. GitHub, Google and Notion also include a **real setup attempt** whose log is published, so the "agent can / you must" split is observed, not assumed.
- **Live generation** for any other app: an agent finds the docs, reads them, and writes a guide in about 15 seconds, streaming its progress. These guides are labeled as not human-verified.
- **A verification page** (`/verification`) showing what we checked, what a plain AI answer gets wrong on the same questions, and a log of what we got wrong ourselves.

## How a claim earns its label

Every claim carries a verbatim quote and a link. Three checks run on it:

1. **The quote is on the page.** Code, not the model, fetches the page and matches the quote. Failures are shown as unverified.
2. **The quote says that.** A separate model call sees only the claim and the quote and rules on support. Unsupported claims are downgraded, and the headline verdict needs full support.
3. **The label is honest.** Estimates say so, absences are labeled as inferred, conflicting sources are both shown, and what could not be verified has its own section.

Confidence labels: *tested by us*, *from official docs*, *community source*, *our estimate*, *sources conflict*, *unverified*. Sourced claims are the quiet default; only the exceptions get a tag.

## Run it

Requires Node 20.12 or newer.

```bash
npm install
cp .env.example .env.local   # then set GEMINI_API_KEY
npm run dev                  # http://localhost:3000
```

Curated guides work without a key. Live generation needs a Gemini key (the free tier is enough). The key is read on the server only and is never sent to the browser or committed (`.env*` is gitignored; only `.env.example` is tracked).

| Variable | Needed | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | for live generation | server-side model access |
| `GEMINI_MODEL` | no | comma-separated model ids, tried in order (default `gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.8-flash`) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | **for any deployment** | durable storage for live guides (see below) |
| `DISABLE_RATE_LIMIT=1` | no | local development only; ignored in production |
| `NEXT_PUBLIC_SITE_URL` | no | absolute URL for share previews |

## Checks

```bash
npm run check      # typecheck, lint, unit tests, and a re-fetch of every cited quote
npm test           # unit tests only (offline)
npm run verify     # re-fetches each cited page and confirms every quote is still there
```

`QA.md` records the last full pass (accessibility, keyboard, responsive, HTTP behavior, failure states) and the faults it found.

`npm run verify` needs network access. Pages change, so a failure there means a guide has gone stale.

Useful scripts (all run with `npx tsx scripts/<name>.ts`):

| Script | What it does |
| --- | --- |
| `verify-seeds` | confirms every quote in `guides/*.json` is still on its page or in our test logs |
| `verify-research` | the same for the verification page's quotes and overrides |
| `judge-seeds` | second review of the curated guides with the support check |
| `audit`, `baseline` | regenerate the snapshots shown on `/verification` |
| `draft-seed`, `probe-seed` | draft a guide from chosen official pages, and record OAuth discovery probes |
| `model-health`, `probe-models`, `list-models` | see which Gemini models your key can use right now |

## Deploying

The app is a standard Next.js 16 app (Cache Components enabled) and deploys to Vercel.

- **Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.** Without them live guides are written to local disk, which serverless instances do not share, so a generated guide's link would not open on the next request.
- **Set `GEMINI_API_KEY`** as a server environment variable.
- Live generation can take up to about 20 seconds; the route allows up to 120. Check your plan's function time limit.
- Live guides expire after 7 days. Curated guides ship in the repo and are cached until the next deploy.

## Decisions worth knowing

- **Evidence over fluency.** A guide that says "not stated" is more useful than a confident guess. Provider approval times are mostly unpublished, and many guides say so.
- **The model never assigns trust.** It proposes text and a quote. Our code assigns the label, and only after the quote is found on the fetched page.
- **"No approval needed" is an inference, not a quote.** No quote can prove something is absent, so it is labeled as inferred from what the official pages do not mention, and is only allowed after at least two official pages were read. Where we actually tried it, the claim is "tested" instead.
- **Real attempts stop at human gates.** The agent drove the console after the account owner signed in, and stopped to ask before accepting any terms. Nothing was published or submitted for review, and no secrets are stored.
- **Free-tier realism.** The app tries several models in order, gives every request a deadline, and rate-limits live generation (6 per IP per 10 minutes, 80 per hour overall).
- **Recently generated guides are curated by rule.** A live guide is listed publicly only if at least one page was confirmed as the provider's own documentation, so the list cannot be filled with junk. Every guide is still reachable by its link.

## Limitations

- **Live guides are only as good as the pages the agent finds.** Documentation behind a login (Workday's, for example) cannot be read, and the guide says so. A first live guide for Notion missed a review timeline that was on a page it never read.
- **The support check is a model.** It can be wrong and it varies between runs. It is a reviewer, not a judge, and every contradiction on `/verification` was hand-reviewed.
- **Quotes prove a claim is on a page, not that the page is current.** Each guide shows the date it was fetched.
- **The plain-answer comparison is one run of one model.** "Can't confirm" means the pages we read are silent, not that the claim is false.
- **Tested claims describe one account on one day.** Provider consoles change; the test logs are dated.
- **No end-user flows were exercised.** We stopped at each consent screen.
- Rate limiting is per server instance, so on serverless it is a brake on casual abuse, not a security boundary.

## Layout

```
src/app/              pages, API route (/api/generate), 404 and error pages
src/proxy.ts          runs before a guide page renders: 404 for unknown slugs, redirect for uppercase ones
src/lib/              schema, fetcher (SSRF-guarded), verifier, pipeline, model client, store
src/components/       search box, claim rows, copy button
guides/               curated guides (JSON, one per app)
public/evidence/      logs of the real setup attempts, served as plain text
research/             audit, plain-answer comparison, hand-review overrides, corrections log
scripts/              verification, drafting and QA tools
```

## License

MIT. See `LICENSE`.
