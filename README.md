# VYX

A community-focused SocialFi application built around conversations, shared rooms and seasonal VP rewards. Members sign in with X, create communities, share text and media, and participate in contribution-based reward rounds.

**Live beta:** https://joinvyx.com · **X:** https://x.com/vyxsocial

squeekchain-project: cd878942-a1fa-40cd-909a-ca45385a6f1d

This repository contains the web client, server endpoints, database schema, migration scripts and isolated tests. VP are application points; they do not guarantee token eligibility, conversion or monetary value. Wallet binding, transferable NFT boosts and token distribution remain planned features. The proposed Squeekchain integration is not implemented in this beta.

## Repository map

| Path | Contents |
| --- | --- |
| `public/` | Responsive web client, styles and application assets |
| `api/` | Vercel endpoints for authentication, rooms, rewards, presence and media |
| `server/` | Access checks, chat services, farming rules and reward accounting |
| `db/schema.sql` | PostgreSQL schema and additive migrations |
| `scripts/` | Local development, builds, migrations and deployment checks |
| `test/` | Isolated unit/integration tests and disposable browser fixtures |
| `docs/` | Product, farming, analytics and mobile architecture notes |

Use Node.js 24, run `npm ci`, then `npm test` for the isolated test suite. Local development requires your own PostgreSQL database and X OAuth application; see Setup below. Copy `.env.example` to `.env.local` and supply your own credentials. Environment files, deployment credentials, uploaded user content and live database records are excluded from this repository.

The application uses Vercel Node functions and PostgreSQL (Neon). Accounts are identified by X OAuth 2.0, using authorization code + PKCE S256. No wallet or password login is included.

## Interface

A conversation-first responsive client: compact navigation, a two-pane room messenger on desktop, separate chat-list and conversation screens on mobile, a quiet post feed and secondary reward screens. New visitors default to Chats and a light theme; saved appearance preferences are preserved. Home-screen metadata is provided in app.webmanifest. See docs/mobile-foundation.md for the current web/native boundary and next steps.

## Features

- Shared profiles, feed, comments, reactions, saved posts and follows.
- Direct messages between mutual followers, stored on the server; 15-second polling.
- Discoverable rooms: X accounts create groups, join/leave and share a persistent group chat. History and member lists require current membership; 10-second polling, older-message pagination, room links and search. Owners can remove messages or close their rooms; members can remove their own messages. Creation and message retries are idempotent. Limits: 5 new rooms/day, 50 memberships/account, 500 members/room, 20 room messages/minute.
- Room messenger: member-only last-message previews and timestamps, per-account unread counts, explicit monotone read acknowledgements, reply quotes, member @mention suggestions and inbox events, and one owner-managed pinned message per room. Removing a message hides its quote text and clears its pin. In-page drafts keep their reply target when switching rooms. Visible directory previews refresh every 15 seconds; room messages refresh every 10 seconds.
- Chest inventory, cryptographic random rewards for previously earned chests and an immutable point ledger. The current quest list has been removed; Quests shows Coming soon and all retired quest claims are rejected by the server.
- A free Halloween collectible mint, once per immutable X account ID, before 2026-11-01 00:00 UTC. The database clock enforces the cutoff. This collectible never awards points. Earlier Halloween claims are migrated to mint records; their point awards are voided with the audit trail retained.
- A private /admin dashboard, restricted by the VYX_ADMIN_X_IDS server-side allowlist, showing connected X accounts, mint receipts, connection times and online activity.
- Visible pages send presence updates every 30 seconds. Online means activity within 90 seconds; signed-in users are deduplicated by account and guests by browser.
- Transaction locks and unique constraints prevent duplicate claims and openings. An opening request can be replayed with the same request ID.
- Separate early-access, November 2026 and December 1–24 season balances; lifetime points on profiles.
- Halloween, late autumn, winter and Christmas themes. Theme selection does not affect reward seasons.

## Room farming

700 million VP farming fund (350 million each season), plus an untouched 300 million VP promotion reserve. November 1–30 and December 1–24, 2026, UTC. December has 25% larger maximum four-hour quotas because it has fewer days. Creating rooms never multiplies the global quota.

Rules are versioned per window. An additive migration announces v2 at a future UTC midnight, at least eight hours after migration. Re-running the migration does not move that boundary. Past receipts and in-flight v1 windows keep the original calculation, including original event halvings. See docs/farming-v2.md.

V2 releases floor(min(window quota, season balance) × min(unique active X accounts / 100, 1)). One current account with valid activity releases 1%; 100 accounts release the full quota. Contribution weights are 1 for the first five accepted messages and 0.5 for the next five per account, across all rooms. At most ten accepted messages per four-hour window; one every five minutes and eight per UTC hour. A removed message loses weight before closing but cannot reset the slot. Eligible text needs 40 characters, 24 letters and five distinct normalized words. Exact copies, numeric variants and near-copies of recent accepted messages do not earn additional weight. These checks do not establish human identity or semantic quality.

Awards use exact integer arithmetic: floor(released VP × personal effective units / max(total base units × coefficient scale, total effective units)). NFT multipliers can exceed 100% and every configured NFT copy stacks. Boosted weights compete for the shared fund; a personal boost cannot overspend the season or round. Below-baseline coefficients retain the earlier v2 allocation and unissued remainder. All live v2 coefficients remain at the base rate until real ownership verification exists.

The planned NFT policy restores the 15% reduction for each held event edition and adds the edition's configured per-token bonus for every copy. No personal multiplier ceiling, duplicate-edition prohibition or per-account holding cap. Bonus rates remain unconfigured: 10 NFTs / 500% is a hypothetical example, not a live rate. Numeric coefficient storage and BigInt calculation support stacking without a JavaScript-safe-integer ceiling. A round-start snapshot records edition quantities and the beneficiary; resale affects a later round. NFT wallet binding, contract verification, mint and marketplace remain deferred.

A qualified milestone account needs eligible activity on three distinct UTC days whose rounds have finalized. Milestones are 100, 250, 500, 1,000, 2,000, 5,000 and 10,000 qualified accounts. Current-round participation for fund release is a separate count. Qualification is not proof of a unique person.

Contributions, windows, pool spend, room drop receipts and user awards are persisted. The campaign lock serializes acceptance, deletion and settlement. Settlement is transactional and idempotent and uses database time. Leaving/closing a room preserves valid earlier activity. Existing ordinary chest awards also consume their season farming fund. All reward sources are combined in reward_ledger.

Vercel Hobby currently supports 100 daily cron definitions per project. Six daily UTC jobs call the same authenticated handler at 00, 04, 08, 12, 16 and 20 hours. Each can run within its designated hour (up to 59 minutes after the configured time); exact-minute settlement is not promised. Active-page reads also settle due rounds. CRON_SECRET stays server-side. The owner dashboard exposes last scheduler completion and pending closed windows. See https://vercel.com/docs/cron-jobs/usage-and-pricing.

The public /api/farm summary excludes per-user history unless authenticated. Room farming activity requires current membership. /api/admin?action=farming uses the existing explicit administrator guard and shows pools, the latest 12 settled windows and latest 100 payout receipts; promotion grants and NFT claims are not exposed.

## Room discovery order

All-room, joined-room and search lists rank conversations by recent activity before pagination, not by creation date or the last message. Seven days of non-deleted X-member messages contribute; weight halves every 24 hours. Case/whitespace-normalized repeats by the same person in the same room count once, at their first occurrence in this window. Each participant-hour contributes `1 + ln(min(distinct messages, 6))`, so regular conversation across people and hours matters more than one person's burst. Media-only messages contribute too. Closed rooms and system messages are excluded; quiet ties use stable room IDs. This score never changes VP or NFT multipliers and does not expose private message text to non-members. Visible lists refresh every 15 seconds; loading additional pages preserves the current view until an explicit refresh.

## Photos and videos

VYX supports up to four photos or one video per room message, direct message, post or comment. Captions are optional for attachments; existing text-only minimums remain unchanged. Photos: JPG/PNG/WebP/GIF/AVIF, up to 10 MiB. Videos: MP4/WebM/MOV, up to 50 MiB; playback depends on the browser's codec support. No transcoding is promised. Rooms also have a dedicated GIF button and accept clipboard image/GIF files; GIFs retain their original animated bytes, show a preview before sending, and can be sent without a caption. GIFs are up to 10 MiB and share the existing four-image limit, membership checks and upload allowance.

Authenticated same-origin requests upload fixed two-MiB parts. Each part is owner/destination checked, size checked and hashed for safe retries, then stored privately. A server-side stream assembles the complete object and validates its size, type and magic bytes. This avoids large function request bodies and browser-to-storage connectivity dependencies. The old SDK callback path remains compatible with the first deployed upload version. Browser upload tokens or Blob URLs are never included in content records returned to viewers.

Private files are streamed through /api/media after checking the current message audience. Public post/comment attachments are public, drafts are owner-only, rooms require current membership and a visible message/open room, and DMs require one of their two participants. Byte-range responses support video seeking. Removing a room message immediately blocks new file reads. Attachments do not independently earn farming VP; eligible captions follow existing text rules.

Private Vercel Blob store: vyx-media. BLOB_READ_WRITE_TOKEN remains server-side. The beta allowance is 20 prepared files / 100 MiB per account per rolling 24 hours, and 512 MiB project reservation including temporary assembly space. Exceeding it pauses new uploads. Unsent uploads expire after 24 hours; the existing six cron jobs clean expired roots and staging parts in bounded batches. Sent files remain associated with their content. New media features share the existing X authorization.

## Setup

Use Node 24, run `npm ci`, and copy `.env.example` to a local `.env.local`. Fill DATABASE_URL, VYX_APP_SECRET, X_CLIENT_ID, X_CLIENT_SECRET, VYX_ADMIN_X_IDS, CRON_SECRET and PUBLIC_APP_URL. Keep every credential outside version control and outside public/.

X configuration: Web App/confidential client, read permissions, callback `https://joinvyx.com/api/auth/callback/x`, website `https://joinvyx.com`. The app requests only `tweet.read users.read` and discards the X access token after reading the identity. Consumer Key and Bearer Token are not OAuth 2.0 Client ID/Secret.

Run `npm run db:migrate`, then `npm start` for local development. Development OAuth requires its own explicitly registered callback. Link the Vercel project and deploy with `vercel --prod`. Credential changes require a fresh deployment. This source archive deliberately excludes Vercel project credentials, local environment files and database contents.

## Verification

`npm test` runs isolated PostgreSQL-compatible tests with PGlite: rewards, claims, season boundaries, private-message isolation, saved-post scope, OAuth state/cookie binding and replay, repeated X login, input validation, CSRF and rate limits.

`node --env-file-if-exists=.env.local scripts/cloud-check.mjs` checks concurrent claims/openings against Neon in a temporary schema; its test data are removed after the check.

`node test/browser-server.mjs` starts disposable, local-only UI fixtures. Its sign-in shortcut exists only in the excluded test file; it is never deployed. Production has no test login route or fabricated members.

## Current limits

This is an early beta. Real X credentials are configured in the live Vercel project. The administrator allowlist must be explicitly configured for the intended owner X identity; an empty list denies all accounts. X API access is subject to the owner's X account limits and pricing. Leaderboards show up to 200 members; feed pages contain 30 stories; conversations show the latest 100 messages. Messages are not end-to-end encrypted. Self-service account deletion, global moderation tools, referrals and token distribution are not implemented. VP do not guarantee token eligibility, conversion or monetary value.


The admin interface is read-only. No user receives admin privileges automatically. Administrative access uses the existing X session; no shared admin password is embedded in the site. The /api/admin endpoint independently enforces the allowlist and sends no-store responses.

## Production domain

Canonical origin: https://joinvyx.com, configured through PUBLIC_APP_URL. www.joinvyx.com redirects to the apex in Vercel. The previous vyx-social.vercel.app domain stays attached to production; its public pages and sign-in entry redirect to the new origin through host-specific rules. API/cron paths are not globally redirected, so scheduled settlement and private media callbacks continue to reach their handlers. Query strings in shared room links are retained. Browser sign-in and analytics preferences are origin-specific; members sign in again on the new domain, using the same X account and existing shared database. No account/VP/content migration is required.

The existing GA4 stream (G-H4RVWMN67F), Yandex counter (114067415) and Vercel project are retained. Their history remains in place; the website sends its actual origin after consent. Counter and stream site URLs are updated to joinvyx.com; Yandex retains the old hostname as an additional allowed address during transition.

## Chest presentation and sound

Room drops and previously earned collectible chests use a 3.4-second opening: anticipation, a release at 1.28 seconds, rays/particles and the existing confirmed reward. The original stereo WAV is reproducible with node scripts/build-drop-audio.mjs; it is fetched from the same origin and decoded locally. Audio starts only on a user interaction and after a confirmed result, at moderate gain. New users have sound enabled; an explicit saved off preference remains off. The modal toggle and Settings → Drop sound share the same browser-local preference. Close, skip, account reset and page hiding stop sound, and pending decoding cannot restart it. Reduced motion keeps results immediate with only a short optional cue. No reward allocation, balances, NFT multipliers or server endpoints are changed.

/drop-lab.html provides a clearly labelled one-click preview without accessing accounts or reward APIs.
