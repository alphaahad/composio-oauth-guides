# Phase 0 findings (docs-sourced, fetched 2026-10-30; nothing here is "tested" yet)

## Composio managed vs custom
- Source: docs.composio.dev/toolkits/managed-auth — 125 toolkits with managed OAuth, 262 bring-your-own (BYO). Check programmatically via `GET /api/v3.1/toolkits/<slug>` -> `composio_managed_auth_schemes`.
- Managed: GitHub, Slack, Gmail/Google*, LinkedIn, Notion, HubSpot, Salesforce, Jira, Facebook, Instagram. BYO: X/Twitter, Shopify, Pipedrive, DocuSign, Xero, Meta Ads, LinkedIn Ads, Vercel, Webflow.
- Source: docs.composio.dev/docs/authentication/custom-app-vs-managed-app — custom app needed for: own name on consent screen, scopes beyond defaults, dedicated rate-limit quota (managed quota is shared), <2 min polling, self-hosted/regional instances (e.g. private Salesforce subdomain), enterprise branding. Token custody unchanged.
- NOT stated by either page: provider verification/review, whether managed apps are verified, the literal callback URL, timelines.

## Providers
| App | Creation | Approval | Timeline stated? |
|---|---|---|---|
| GitHub | UI self-serve (OAuth App); GitHub App manifest flow needs a human click, 1h window | none stated | n/a |
| Slack | UI, or `apps.manifest.create` with config token (human generates first token, expires 12h) | Unlisted distribution self-serve; Marketplace needs 10+ active workspaces | Prelim <=10 business days; functional <=10 weeks (6 for resubmits) |
| Google | Cloud Console | Non-sensitive: optional; sensitive: verification; restricted: verification + annual CASA assessment | Sensitive "up to 10 days"; support page also says "several months"; restricted: none stated |
| LinkedIn | Developer Portal | Open permissions (Sign in w/ OIDC, Share) self-serve; Marketing/Sales/Talent/Learning need approval or partner programs; Compliance closed | none stated |
| Shopify | Dev Dashboard | Custom distribution: no approval; public: approval + App Store registration fee | none stated |
| X | Developer Console | pay-per-usage credits (docs don't mention a free tier) | none stated |
| Meta | App Dashboard | App Review required for users without a role; Advanced Access needs Business Verification | none stated |

## Corrections to my earlier claims
- Google testing-mode "7-day refresh token / 100 test users": NOT found in fetched pages (only "user cap" and "limited refresh token lifetime"). Unverified. The 100 figure found is for unverified apps ("100 new users").
- GitHub "no API to create OAuth apps": not confirmed or refuted by docs; the manifest flow exists for GitHub Apps only.
- Redirect URI rules: GitHub up to 10 callbacks; Slack HTTPS-only, no `#`, must match or be subdirectory.

## Gaps to close by testing
GitHub callback rules page, Google "Manage App Audience" page (15549945), LinkedIn increasing-access page, Meta access-levels/Business Verification help, Shopify review-process page.
