# Profile recognition

Recognition is a global, non-seasonal profile status based on current real reactions. It awards no VP and has no role in farming, drops, quests, referrals, NFT selection, whitelist or ranking.

`reputation.recognized` counts distinct `(content kind, content ID)` pairs: room messages and posts with at least one external reaction. Every emoji counts equally; multiple people reacting to one item still recognize one contribution. `reputation.people` counts distinct reactor accounts across both sources together. Self-reactions and DM reactions never count.

The owner explicitly chose the same global total for every profile visitor, rather than viewer-membership-specific totals. Only undeleted messages in unarchived rooms and existing posts qualify. Moderator removal uses those same existing delete/archive mechanisms. Leaving a room does not erase the content or recognition while that room remains available. Existing genuine reactions count immediately; removing the final eligible reaction reduces recognition. No new score/ledger table, backfill, award or write endpoint exists.

Blocks between author and reactor are excluded in both directions, matching the existing interaction guard. Removing a block makes retained real reactions eligible again. Mutes are a personal visibility preference and do not reduce global recognition. A profile viewer's unrelated memberships, mutes or blocks do not personalize the aggregate; existing profile content and room-history restrictions remain intact. Nothing returns reactor identities, message IDs or room breakdowns with this metric.

The server adds `{recognized, people}` only to the signed-in account in `state` and to `person` in `member-profile`. Member listings, post authors, leaderboards, room lists and eligibility responses are unchanged. Both own and public profiles show `Recognized`, `by N people` and a brief explanation near Posts / Following / Followers. Opening the owner profile reads fresh profile data; stale responses from another account are ignored. The Soft Pop layer remains the production visual foundation.

The removal test exposed an existing moderation defect: a liked/saved/replied-to post could not be deleted because its dependent records blocked the foreign key. The existing authorized post-removal branch now locks that post and removes its likes, saves and replies in the same transaction. Its and its replies' media are detached and marked deleting, immediately become unreadable, and are removed by the existing cleanup job. Authorization and reaction behavior are unchanged. No production post was removed for testing.

## Query plan and migration

`server/reputation.js` reads existing tables. Correlated reaction lookups use indexes on the author's content and on message reactions. An additive covering index on `reactions(post_id,user_id)` avoids rescanning all post likes for each authored post.

`node scripts/check-reputation-plan.mjs` creates an isolated PGlite fixture: 200 accounts, 20,000 room messages, 40,000 message reactions, 5,000 posts and 10,000 likes. It compares EXPLAIN ANALYZE before/after the index and returns aggregates. On the development run, the like subquery changed from filtering 9,998 rows per authored post to an indexed lookup of two rows; total query time was approximately 68.3 ms before and 10.7 ms after. These are local fixture observations, not a production latency guarantee. The fixture produced 125 recognized contributions from two unique people. A stored counter was unnecessary.

Migration: `db/reputation.sql`, also included in the full schema for fresh installations. It creates only the index, using `IF NOT EXISTS`; it does not rewrite any content, reaction, view or reward record. Tests run it twice and compare records and totals.

Before deployment run `node --env-file=.env.local scripts/rollout-reputation.mjs --apply`. The script uses a consistent snapshot, bounded lock/statement timeouts and checks preservation of users, posts, likes, messages, reactions, media, views, reward records, VP and pool spend. Deployment may safely follow the additive index creation; no data backfill is required.
