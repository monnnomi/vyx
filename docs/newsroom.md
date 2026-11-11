# VYX Newsroom

The existing VYX app now has `/#news`, English/Russian briefs and direct article links `/?story=<uuid>#news`. It is independent of social posts, referrals, reactions, VP and NFT eligibility. No test sources or stories are seeded into production.

## Operation

- Add the owner's chosen X accounts in `/admin` → Newsroom. An @username or X profile URL is accepted. Sources start empty. Pausing/removing a source retains its previous stories and collection history.
- Connect **server-only** `X_NEWS_BEARER_TOKEN` (app-only Bearer token from the VYX X project) and `OPENAI_API_KEY` (official OpenAI API). Existing temporary end-user quest tokens are deliberately not used.
- The ORBITA key currently points to a separate compatible proxy. Do not silently send that credential to OpenAI or restart ORBITA's paid collection. Configure the intended VYX credential explicitly.
- Enable automation only after credentials and sources are ready. It starts paused. The scheduler and public section can be deployed before this step with zero X/AI requests.
- The current writer/verifier uses `gpt-5.4-mini-2026-03-17`, two independent structured-output calls, `store:false`, fixed endpoint and redirects disabled. No scraping or arbitrary link fetching.
- 24 daily UTC Vercel cron routes invoke `/api/news-cron/<hour>` at minute 25. One source and at most one story per run stay within the 60-second function window; sources rotate fairly within the allowance. This does not guarantee an hourly scan of every source. Pagination preserves the old high-water mark until all pages are imported.
- The initial import starts at the preceding 24 hours. Sources older than 48 hours are not turned into new briefs. Replies, reposts, truncated posts, duplicate post IDs and identical text are ignored. Same-event screening also compares recent story titles; semantic deduplication is best-effort.
- Only low-risk source-supported bilingual stories can auto-publish, up to six/day. Financial, token/NFT/airdrop and security claims stay for manual review. This is source consistency checking, not independent real-world verification. Reader labels retain that distinction.
- Uncertain/failed requests retain conservative reservations. The default news allowance is $1 per UTC day, configurable from $0 to $1. It is separate from the existing quest-verification allowance and is an app-side estimate/reservation, not a provider invoice or guarantee against changed provider pricing. Provider billing limits should also be set before activation.
- Reservations: X profile lookup 1 cent; up to five posts 3 cents; each fixed-model AI call 6 cents. This intentionally over-reserves. News expenses are not drawn from VP pools.
- Failed drafts retry after an hour, then enter review after three attempts. Review never publishes incomplete, unsupported or translation-mismatched drafts. Admins can publish checked drafts, reject, retry and withdraw stories. Withdrawal hides public access and keeps audit history.

## Setup and validation

Apply `db/news.sql` before deploying the routes: `node --env-file=.env.local scripts/rollout-news.mjs --apply`. The migration is additive/idempotent; the script checks that existing community and VP totals do not change.

`npm test` runs isolated PGlite cases. `VYX_QA_PORT=4174 VYX_QA_NEWS=1 node test/browser-server.mjs` adds one explicitly labeled local-only article for browser checks, with no external API calls. Never put these fixtures in production.

## References

- Responses structured JSON: https://developers.openai.com/api/reference/resources/responses/methods/create
- Fixed model/pricing reference: https://developers.openai.com/api/docs/models/gpt-5.4-mini
- X read rates reference: https://docs.x.com/x-api/getting-started/pricing

Provider rates were checked on 11 November 2026; refresh them before changing the model or activating a larger allowance.
