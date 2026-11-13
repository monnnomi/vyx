# VYX X quests

Original campaign post: https://x.com/vyxsocial/status/2119014238463152187

| Action | VP |
| --- | ---: |
| Follow @vyxsocial | 1000 |
| Like campaign post | 1500 |
| Repost campaign post | 2000 |
| Reply directly to campaign post | 1500 |
| Quote campaign post | 2500 |

Original campaign total: 8500 VP.

Product update post: https://x.com/vyxsocial/status/2121127790556680479

| Action | VP |
| --- | ---: |
| Like the product update | 1500 |
| Repost the product update | 2000 |
| Reply directly to the product update | 1500 |

New rewards: 5000 VP. All eight tasks: **13,500 VP**. One award per immutable X account and task, across all seasons. Previous task IDs and receipts are retained; supporting the first post cannot complete a task for the second post. No migration or historical reward recalculation is needed.

## Verification and accounting

`GET /api/vyx?action=tasks` gives the public task definitions and the signed-in owner's statuses. `POST verify-tasks` requires a session and the same origin. The backend obtains the actor's X identity from that session; client-provided user IDs, prices and completion flags are ignored. Only official X API proofs can award VP.

The follow lookup checks `connection_status` and falls back to the user's following list if that field is unavailable. Likes use the authenticated user's liked posts. Reposts/replies/quotes use the authenticated user's timeline, checking both author_id and each task’s exact referenced_tweets ID/type. Like and timeline scans are shared across pending tasks in the same check: at most three pages per kind, not three pages per campaign post. Timeline since_id is the oldest post ID among the pending timeline tasks; pagination stops only after every requested post/type pair is found, or the bounded scan ends. A failed shared scan remains unavailable for every affected task, without repeating the same failed request for each task. Checks are bounded to recent pages (up to 30 likes/posts, 20 follows in fallback); absence remains not-verified, never a positive award. Older activity beyond that range is not guaranteed to be found. X errors, partial responses, missing permissions, rate limits and missing credits never award VP.

Unique database constraints prevent duplicate claims. A transaction locks the member, debits only the `promotions` pool within its 300M VP cap and creates the immutable reward receipt. The receipt is included in reward_ledger, so seasonal rankings, total VP and NFT eligibility use the same actual award. Existing farm budgets and receipts are retained.

## Optional X connection

Ordinary sign-in retains its original scopes and does not store an X token. Quests separately request `tweet.read users.read follows.read like.read`, without write, DM or offline access. The OAuth attempt binds the expected X account, state cookie and PKCE verifier. The access token is AES-256-GCM encrypted with an app-secret-derived key and X ID as authenticated data; it is never returned to the browser or logged. It expires after at most two hours and can be disconnected from Quests. No refresh token is requested.

Participants perform the actions themselves on X. The quote task opens X’s post composer with the campaign post URL already filled in; participants add their own words and publish themselves. Returning from a task link schedules a check while Quests is visible, with a one-minute interval. Check and Check all are also available. Successful checks credit VP automatically, without a second claim step. The page count, reward total and progress bar use the server-provided total rather than a hardcoded campaign maximum.

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


## Shared-allowance feedback (13 November 2026)

The owner kept the existing $1/day quest-verification cap after diagnosing 98 cents reserved and only two cents remaining, insufficient for a five-cent post-read reservation. Do not raise or reset that counter as a troubleshooting shortcut. News has a separate allowance.

Task state exposes only ready/limited/paused/complete availability, per-task `canCheck`, and the next UTC reset, not the project's exact spending figures. A verification call that cannot fund any of its pending requested actions returns the unchanged state before contacting X or writing checks/rewards. Existing receipts remain authoritative. A one-cent profile lookup can still be available when a five-cent post lookup is not.

Quests show an explicit pause and UTC reset time, disable unavailable Check buttons and offer **Refresh status**, a read-only state request. Returning from X checks only the task whose link was opened, rather than all tasks. Full-list verification remains an explicit action or the initial authorized connection check. A focus/visibility event after the reset refreshes availability without making a paid X verification call. Read-only scopes, the two-hour grant, per-account limits, daily cap and promotion reserve remain unchanged.


## Automatic queue and priority (14 November 2026 UTC)

The existing authenticated 15-minute Vercel Schedule now checks quests before collecting or writing news. Activation starts at `2026-11-14T00:00:00Z` (05:00 Yekaterinburg); `X_TASK_AUTOMATION_START_AT` is an optional deployment override. No migration or new schedule is needed. Each run handles one account, then authenticated background dispatch continues eligible work. New paid news reservations wait while fundable quest work is due or already running. News can continue once the due queue is empty, its accounts are waiting between checks, their access has expired, or the separate quest allowance is exhausted. An already-started provider request is not cancelled.

The queue uses existing grants, task receipts, check locks and counters. Only non-system users with all four approved read-only scopes and unexpired, matching X identity qualify. Accounts with no outstanding fundable task are skipped. Least-recently-checked accounts go first; negative/unavailable checks wait at least 15 minutes before another automatic pass. The one-minute lock and 20 checks/account/UTC-day limit are shared by manual and background verification, and charged only after acquiring the check lock. The independent quest cap stays $1/day: news funds are never transferred to quests. Empty or failed proof responses never credit VP. Budget limits and queue length mean no guarantee that every participant is verified in one day.

Automatic processing works even if the browser is closed, **only while the existing two-hour grant remains valid**. No offline scope, refresh token or longer access was added. A participant must reconnect after expiry. Disconnecting cancels further background checks. Existing Check buttons and targeted return-from-X checks remain optional shortcuts. While Quests is visible, a one-minute read-only status refresh picks up new receipts/VP; it never calls X.
