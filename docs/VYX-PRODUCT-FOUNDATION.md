# VYX — product foundation, 1 November 2026

## Product

**Your presence matters. Your contribution counts.** VYX is a social space with a public feed, member rooms and a record of meaningful participation. People and conversation come first. VP are application points, not money, a token entitlement or an investment. No wallet or on-chain action is needed in this release.

The primary loop is discover people → join a room → contribute → receive a finalized round result → return to the conversation. Four-hour rounds give shared rhythm without requiring anyone to watch a countdown. Opening a drop is optional presentation of an existing award.

## Source audit

This is a working vanilla-JS application on Vercel, with Node API functions and a shared PostgreSQL database. No framework migration is necessary for the first vertical slice. Existing capabilities preserved:

- OAuth 2.0 X login with PKCE, server sessions, immutable X identity and minimum read scopes.
- Profiles, text posts, likes, comments, saved posts, following and mutual-follow direct messages.
- Discoverable member rooms with create/join/leave, owner close/remove and account-owned message deletion. Member-only persisted history with cursor pagination. Ten-second chat polling; DMs poll every 15 seconds. These are not WebSocket streams.
- One global UTC four-hour farming pool. Eligibility, cross-room cooldown/hour cap, duplicate detection, integer allocation, transaction locks, idempotent settlement and bounded seasonal funds.
- Account, mint, presence, room and award administration, restricted to an existing immutable X allowlist. Online is a recent presence signal, not an earning metric.
- Legacy collectible chests. Halloween mint closed at 1 November 00:00 UTC and remains closed; one mint per X identity. Quests remain Coming soon.

Gaps before this release: the feed was below a large promotional hero; rewards were split into individual room rows; no durable acknowledgement of a personal round; notifications were a reward popup; no coherent appearance/motion settings. There are no media uploads, repost/quote objects, unread DM receipts, room reactions/replies/mentions/pins, search over all messages, reports/ban workflows or live activity sockets. Public member search currently covers the bounded loaded selection, not the complete database.

## Information architecture

Primary navigation: Home, Explore, Rooms, Notifications, Messages, Drops, Profile, Settings. Administration is visible to authorized owners in Settings and the existing admin link. Collection and Leaderboard remain secondary destinations. The mobile bar prioritizes Home, Rooms, Drops, Notifications and Profile; Explore, Messages and Settings are also reachable from the mobile More menu.

Home presents a compact round status, room suggestions and the feed/composer. For you currently means recent community posts, transparently labelled; no algorithmic personalization is claimed. Following and Saved are real filters. Explore searches loaded people, recent posts and room suggestions, with a link to server-backed room name search. Rooms keep the chat central with contribution information alongside it; mobile details are user-opened.

Drops is an account's source of truth for finalized rounds, confirmed room VP, today (UTC), current eligible messages, tentative current share and retained history. Notifications initially include real follows, comments and finalized drops, filtered Social/System with durable read acknowledgement. Settings saves appearance and motion locally and exposes the existing profile, data/privacy and admin actions.

## Visual system

Graphite is the default. Light remains selectable. No promotional full-screen hero is required before content.

| Token | Graphite | Light |
| --- | --- | --- |
| Canvas | #0D1016 | #F5F6F8 |
| Surface | #141922 | #FFFFFF |
| Separator | #272E3B | #DDE2EA |
| Primary text | #EEF1F8 | #1B2636 |
| Secondary text | #929CAF | #65728A |
| Accent | #8ABAFF | #3569B1 |
| Reward | #D7B879 | #8A651F |

DM Sans is locally hosted. Product headings use weight/scale rather than decorative fonts. Cards use 9–14px radii, thin dividers, restrained depth and consistent 8/12/16/24px spacing. Blue identifies navigation/action, soft gold identifies a recorded reward, muted purple differentiates room artwork. Seasonal details are independent of balances and calendar windows. Icon buttons have accessible names, text is escaped and reduced motion respects the OS preference as well as an explicit setting.

## Drop concepts and storyboard

1. **Sky Drop (selected):** an elliptical portal opens above a tangible geometric container; it descends, lands with one short ring, then waits. Strongest spatial identity. CSS geometry requires no video, WebGL, animation library or additional remote assets.
2. **Materialization:** the container resolves from a blurred field into solid geometry. Quietest entry and a good compact alternative.
3. **Energy:** a concentrated point expands into a container. More abstract and potentially more intrusive; not the default.

The standalone `/drop-lab.html` comparison is an explicit simulation. It never calls balance APIs, credits points or asks for a wallet. The three entry concepts share a ready/open/result sequence and support skipping and reduced motion.

Live storyboard:

- **ACTIVE:** countdown from server clock; contribution and estimate can change.
- **Awaiting calculation:** a passed timer is not a success signal. Show finalizing; retain activity if the processor is delayed.
- **FINALIZED:** award rows already committed and included in the balance. A badge invites the user to view; no automatic chat overlay.
- **Delivery:** only after reading the authenticated finalized result. Container arrives, waits for Open drop.
- **Opening:** persist a reveal acknowledgement, then lift the lid/separate the panel/light. Skip gives the same result.
- **Result:** one personal round sum and room breakdown, including activity and finalized timestamp. Reopening history shows this recorded result directly.

Zero-point finalized activity is a valid result, not a fake win. Missing a presentation loses nothing. No random amount is chosen by the animation.

## Accounting and architecture

`farm_windows` is the round authority; `farm_contributions` records validated activity; `farm_awards` is the immutable per-room/account ledger. Personal results are a grouped read over this ledger, so older awards automatically appear without a backfill that could double-pay. Pagination uses the unique round timestamp. `drop_reveals(user_id, window_start)` stores only durable acknowledgement. It is not used by the allocator. `inbox_state` stores the latest read acknowledgement for notification events.

All result and reveal endpoints require a current X session. A client supplies only a round identifier; user identity and amount always come from the server. A foreign account cannot view another result. Reveals are idempotent and never add ledger entries. POST routes retain origin checks and rate limits. DB migration is additive and idempotent.

### Preserve the agreed allocation model

The current user-approved maximum is 700M VP farming and 300M VP promotions, with no obligation to issue the maximum. At community thresholds, future activity weights halve. The denominator remains **raw validated activity**; normalizing by reduced weights would cancel the agreed halving when everyone has the same reduction. This release preserves the existing formula, floors and receipts rather than retroactively adopting the master prompt's preliminary normalized formula. Historical contributions retain their accepted weights. NFT verification remains disabled and is outside this points-only delivery.

### Honest operational limits

The existing settlement transaction atomically locks shared state/pools/windows, creates awards and closes a window. On failure it rolls back; a later call retries without a half-awarded round. Vercel Hobby has an existing daily cron, while active reads process due windows. The four-hour boundary is exact for eligibility, but independent payout execution at every boundary is **not guaranteed** by a daily scheduler. A dedicated scheduler/queue or suitable hosting plan is needed for guaranteed unattended four-hour processing.

This release exposes ACTIVE/FINALIZED and pending processing accurately. It does **not** claim to have added persisted CALCULATING/FAILED job states, a retry queue or an operator recovery console. Scaling settlement beyond the current small service needs those pieces and monitoring. Current duplicate detection is normalized text plus caps; it is not semantic AI moderation or proof of unique humanhood. X identity prevents duplicate accounts for the same X ID, not Sybil behavior across different X accounts.

## Delivery blocks

**Block 1 (this implementation):** source audit, shared dark/light design, content-first Home, Explore, navigation, real aggregated Drops, durable reveal/history, opt-in Sky Drop, standalone three-concept lab, real basic notification inbox, appearance/motion settings, additive DB migration and regression verification. Preserve working auth/chat/accounting.

**Block 2 — social depth:** media storage with validation/limits and deletion lifecycle, repost/quote objects and bounded queries, canonical public profiles, notification pagination and unread DM receipts. Add real search indexes/endpoint rather than claiming that loaded content is a global search.

**Block 3 — rooms:** reply/reaction schema, mentions with membership checks, pinned messages, indexed message search and member roles. Reporting and moderation queues, soft deletion/audit and appeals/retention policy. Consider SSE/WebSockets only with a hosting/pubsub plan and measured demand.

**Block 4 — operations:** versioned future-effective rule sets, preview and owner audit log, round job states SCHEDULED/ACTIVE/CALCULATING/FINALIZED/DELAYED/FAILED, retry/error records, pause/resume allocation controls and an independent scheduler. No silent retroactive edits. Alerting, backups, rate-limit pruning, query/load tests and performance budgets before a large launch.

**Block 5 — refinement:** user research, mobile chat ergonomics, accessibility contrast/keyboard audit, curated room categories and genuine recommendation signals. No paid service or financial mechanic is introduced as a design dependency.
