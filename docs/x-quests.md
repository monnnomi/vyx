# VYX X quests

Campaign post: https://x.com/vyxsocial/status/2119014238463152187

| Action | VP |
| --- | ---: |
| Follow @vyxsocial | 1000 |
| Like campaign post | 1500 |
| Repost campaign post | 2000 |
| Reply directly to campaign post | 1500 |
| Quote campaign post | 2500 |

Total: 8500 VP. One award per immutable X account and task, across all seasons.

## Verification and accounting

`GET /api/vyx?action=tasks` gives the public task definitions and the signed-in owner's statuses. `POST verify-tasks` requires a session and the same origin. The backend obtains the actor's X identity from that session; client-provided user IDs, prices and completion flags are ignored. Only official X API proofs can award VP.

The follow lookup checks `connection_status` and falls back to the user's following list if that field is unavailable. Likes use the authenticated user's liked posts. Reposts/replies/quotes use the authenticated user's timeline, checking both author_id and the exact referenced_tweets ID/type. Checks are bounded to recent pages (up to 30 likes/posts, 20 follows in fallback); absence remains not-verified, never a positive award. Older activity beyond that range is not guaranteed to be found. X errors, partial responses, missing permissions, rate limits and missing credits never award VP.

Unique database constraints prevent duplicate claims. A transaction locks the member, debits only the `promotions` pool within its 300M VP cap and creates the immutable reward receipt. The receipt is included in reward_ledger, so seasonal rankings, total VP and NFT eligibility use the same actual award. Existing farm budgets and receipts are retained.

## Optional X connection

Ordinary sign-in retains its original scopes and does not store an X token. Quests separately request `tweet.read users.read follows.read like.read`, without write, DM or offline access. The OAuth attempt binds the expected X account, state cookie and PKCE verifier. The access token is AES-256-GCM encrypted with an app-secret-derived key and X ID as authenticated data; it is never returned to the browser or logged. It expires after at most two hours and can be disconnected from Quests. No refresh token is requested.

Participants perform the actions themselves on X. Returning from a task link schedules a check while Quests is visible, with a one-minute interval. Check and Check all are also available. Successful checks credit VP automatically, without a second claim step.

## Operations

- Apply the additive migration with `node --env-file=.env.local scripts/rollout-x-tasks.mjs --apply`. Its transaction verifies that existing content/reward totals and promotion spend are unchanged.
- X Developer credits and endpoint access are required. This work does not purchase credits or enable auto-recharge.
- Default `X_TASK_DAILY_BUDGET_CENTS=100` reserves conservative per-request upper bounds for task-verification reads (one user = 1 cent; ten posts = 5 cents; ten follows = 10 cents) before an X call. Failed calls also retain their reservation. This is an application allowance, not a reconciliation of the X invoice, and excludes ordinary OAuth/profile reads. Recheck rates when changing API usage. Each account also has a 20-check daily limit and a one-minute check interval.
- Tokens/credentials and raw X lists are never stored in evidence logs. Proof IDs and reward receipts are retained to enforce one award per task.
- Test fixtures and provider responses are isolated in test/browser-server.mjs and are excluded from Vercel deployment.

Official API references reviewed November 8, 2026:
https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code
https://docs.x.com/x-api/users/get-user-by-username
https://docs.x.com/x-api/users/get-following
https://docs.x.com/x-api/users/get-liked-posts
https://docs.x.com/x-api/users/get-posts
https://docs.x.com/x-api/getting-started/pricing
