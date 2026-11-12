# VYX Newsroom

The existing VYX app has `/#news`, English-only briefs and direct article links `/?story=<uuid>#news`. It is independent of social posts, referrals, reactions, VP and NFT eligibility. No test sources or stories are seeded into production. All generated articles, headings and highlights are English only. There is no language switch; legacy language query parameters/preferences cannot select Russian. Legacy translation columns remain unused for compatibility, without a destructive schema migration.

## Operation

- Add the owner's chosen X accounts in `/admin` → Newsroom. An @username or X profile URL is accepted. The owner selected `RobinhoodCrypto`, `RobinhoodApp`, `vladtenev` and `blknoiz06` on 12 November 2026. Sources are added via the admin or the explicit `scripts/configure-news-sources.mjs --apply` bootstrap; deployment alone never inserts sources. Pausing/removing a source retains its previous stories and collection history.
- Connect **server-only** `X_NEWS_BEARER_TOKEN` (app-only Bearer token from the VYX X project) and news-only `VYX_NEWS_AI_API_KEY`. Existing temporary end-user quest tokens are deliberately not used.
- The owner selected the same AI service as ORBITA: `VYX_NEWS_AI_BASE_URL=https://triklz27.ru/v1`, `VYX_NEWS_AI_MODEL=gpt-6-luna`. The existing service credential is copied only into VYX production as a sensitive, news-only variable. ORBITA configuration and collection remain unchanged. Never send this key to the official OpenAI endpoint. An official OpenAI key fallback is accepted only with the official endpoint.
- Enable automation only after credentials and sources are ready. It starts paused. The scheduler and public section can be deployed before this step with zero X/AI requests.
- Writer/verifier make two independent structured-output calls, `store:false`. The server permits only `https://api.openai.com/v1` and `https://triklz27.ru/v1`, disallows URL credentials, queries and alternate ports, and disables redirects. The allowlisted models are the original `gpt-5.4-mini-2026-03-17` and ORBITA's `gpt-6-luna`. No scraping or arbitrary link fetching.
- Batched collection checks all selected accounts on a target 15-minute Vercel Schedule, then uses authenticated background continuations for pagination and the article queue. Hosting jitter and daily allowance can delay completion. See the batch section below.
- The initial import starts at the preceding 24 hours. Sources older than 48 hours are not turned into new briefs. Replies, reposts, truncated posts, duplicate post IDs and identical text are ignored. Same-event screening also compares recent story titles; semantic deduplication is best-effort.
- Only low-risk source-supported English stories can auto-publish, up to six/day. Substantive product announcements and reasoned market theses are eligible. Empty ticker hype, greetings, memes and engagement bait are rejected; attributed calls appear as **Market view**, preserving the author's conditions and uncertainty. Wallet claims, guaranteed returns, allegations and security incidents stay for review. This is source consistency checking, not independent real-world verification. Reader labels retain that distinction.
- Uncertain/failed requests retain conservative reservations. The default news allowance is $1 per UTC day, configurable from $0 to $1. It is separate from the existing quest-verification allowance and is an app-side estimate/reservation, not a provider invoice or guarantee against changed provider pricing. Provider billing limits should also be set before activation.
- Reservations in batch mode: X profile lookup 1 cent; up to ten posts 5 cents, with unused reservation released only after a valid complete response; `gpt-6-luna` AI call 1 cent; official `gpt-5.4-mini-2026-03-17` call 6 cents. The input bound is 48 KB and output bound 3,200 tokens, including any model reasoning. These reference-rate upper reservations round up to whole cents. News expenses are not drawn from VP pools.
- AI calls can use up to 30 seconds within a shared 52-second processing deadline, leaving time for database writes inside the 60-second function window. Failed drafts retry after an hour, then enter review after three attempts. Review never publishes incomplete, unsupported or non-English drafts. Admins can publish checked drafts, reject, retry and withdraw stories. **Run one cycle** uses the same enabled flag, atomic spending reservations, concurrency lease and publication checks as cron; it never bypasses them. Only allowlisted admins with a same-origin session can invoke it. X authentication/credit/access/rate failures appear separately in source status. Withdrawal hides public access and keeps audit history.

Stories display the VYX Newsroom byline, the original X source, publication date, a short standfirst, highlights and focused sections. Market views are explicitly labeled as source opinion rather than VYX trading advice. The three Robinhood-related accounts belong to one editorial source group; repeated statements are not independent corroboration. Generated text is escaped and no arbitrary external links from model output are rendered.

## Setup and validation

For a first newsroom installation, apply `db/news.sql` before deploying the routes: `node --env-file=.env.local scripts/rollout-news.mjs --apply`. The migration is additive/idempotent; the script checks that existing community and VP totals do not change. For an existing newsroom apply `node --env-file=.env.local scripts/rollout-news-editorial.mjs --apply` before deploying the editorial update; it adds the presentation JSON column and `markets` category while preserving existing stories. Test migrations in PGlite first. JSON write parameters bind as text before the jsonb cast so postgres.js does not encode them twice. `db/news-json.sql` repairs existing encoded JSON strings without changing article content, status or publication history; its repeatability and the real driver serializer are covered by tests.

`npm test` runs isolated PGlite cases. `VYX_QA_PORT=4174 VYX_QA_NEWS=1 node test/browser-server.mjs` adds one explicitly labeled local-only article with headings, highlights and English presentation for browser checks, with no external API calls. Never put these fixtures in production.

## References

- Responses structured JSON: https://developers.openai.com/api/reference/resources/responses/methods/create
- Fixed model/pricing reference: https://developers.openai.com/api/docs/models/gpt-5.4-mini
- X read rates reference: https://docs.x.com/x-api/getting-started/pricing

Provider rates were checked on 11 November 2026; refresh them before changing the model or activating a larger allowance.

The ORBITA configuration lists `gpt-6-luna` at $0.10 / $0.50 per 1M input/output tokens. These are provider reference rates, not an independently verified invoice. The 1-cent request reservation for this model rounds up the bounded request estimate. Revise it if the provider changes pricing; app-side reservations are not a hard provider billing limit.

## Batch collection and immediate processing (12 November 2026)

The owner selected a strict $1/day app allowance and batched polling, rather than paid push events with in-flight delivery overages. There are no X Activity subscriptions or webhook endpoints in this implementation.

- Up to 100 active accounts, including bulk addition in the admin. Public account IDs are verified once and cached; initial identity reads consume the existing allowance and may need to continue after its next UTC reset.
- The selected list is split into stable queries of at most 20 usernames, each within 512 characters. Every due query is checked in one pass where runtime permits; further pages and unfinished work resume in authenticated background workers. One quiet or broken source does not prevent known accounts from being checked.
- Recent Search requests return at most ten posts. Reserve five cents before requesting; after a complete valid response retain `ceil(post_count / 2)` cents and release only the unused part. Failed, partial or ambiguous requests keep the full reservation. Settlements are idempotent and tied to the reservation's original UTC day. Empty successful checks retain zero cents. This is conservative accounting against the published reference rate, not invoice reconciliation.
- Part of the allowance stays available for AI (up to one quarter, normally 20 cents). Collection stops before consuming that portion; the shared atomic ledger still caps all new X/AI calls at the configured daily allowance. UTC reset remains 00:00, 05:00 Asia/Yekaterinburg.
- Preserve each query's cursor and pending high-water mark until all pages are imported. Unsupported, repeated, truncated, replied-to and retweeted material stays out of the article queue. Existing 48-hour freshness and English editorial checks remain.
- Durable `news_items` are processed immediately after collection, then an authenticated `POST /api/news-cron` continuation drains due work under the same budget, six-publication ceiling, concurrency lease and function deadline. Sharing the existing function keeps deployment within the Hobby function count. The scheduler rescues work after a failed dispatch. `@vercel/functions.waitUntil` retains the background promise after the worker acknowledges the request.
- `vercel.json` declares the static `vyx-news-scan` Schedule at `*/15 * * * *` in UTC, GET `/api/news-cron`, with existing `CRON_SECRET` authorization. The six farm Cron Jobs are preserved. Scheduling has provider jitter (Hobby can deliver up to 15 minutes late), so 15 minutes is a target cadence, not a strict latency guarantee. Legacy hourly news routes remain authenticated compatibility aliases without scheduled triggers.

Apply `db/news-batch.sql` before deployment via `node --env-file=.env.local scripts/rollout-news-batch.mjs --apply`; migrations preserve users, community content, VP and existing news. Browser QA uses the isolated fixture server only. Source identities and news in production must be real.

References: [X Recent Search](https://docs.x.com/x-api/posts/search-recent-posts), [X read pricing](https://docs.x.com/x-api/getting-started/pricing), [Vercel static Schedules](https://vercel.com/docs/schedules/configuration), [scheduled path authentication](https://vercel.com/docs/schedules/handle-runs), [background promises](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#waituntil).

## News discussions

Published articles have public, paginated comment threads and viewer-aware comment counts. Signing in with X is required to write. Members can edit and delete their own comments; allowlisted administrators can delete comments but cannot edit someone else's words. Existing block/mute controls hide matching authors and their contributions from the viewer's counters. Withdrawn or unpublished articles cannot be discussed through the API.

Comment writes use `/api/news`, same-origin checks, session authorization, account/IP rate limits and a 30-new-comments/hour account limit. A stable request ID prevents duplicate submissions; deletion retains an internal tombstone so a retry cannot restore the comment. Comments do not call X/AI, use the news allowance, create community posts or award VP.

Add `db/news-comments.sql` before deploying the new reader. `node --env-file=.env.local scripts/rollout-news-comments.mjs --apply` applies the additive migration and checks that existing users, posts, messages, articles and VP totals are preserved. The complete fresh schema also includes the new table. Browser QA must use the isolated `VYX_QA_NEWS=1` fixture, never fabricated comments on production articles.
