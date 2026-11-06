# Fair room drops v2

## Release and preservation

The migration chooses a future UTC midnight with at least eight hours of notice. The date is stored in farm_rule_versions and exposed in /api/farm.policy.effectiveAt. Repeat migration is idempotent. Only empty, unfinalized future windows adopt v2. Every window carries its own version; no earned VP are recalculated. The old 50% milestone policy remains only in v1 calculation.

## Budget and example

700M VP for farming, 300M VP reserved for promotions. November and December each have 350M maximum. Per round, available = floor(min(maximum quota, season balance) × min(active accounts, 100) / 100). Empty rounds issue zero and unused amounts do not roll forward.

For a maximum quota of 1,944,444 VP and 10 active X accounts, available VP = 194,444. If one account contributes weight 3 of total weight 15, its full-coefficient allocation is floor(194,444 × 3 / 15) = 38,888 VP. At activation, NFTs increase personal reward weight. The denominator is max(total base weight, total reward weight), so a 5× multiplier increases relative weight within the shared fund. For equal base activity, multipliers 5× and 1× give 5/6 and 1/6 of that fund, subject to integer rounding. If all coefficients are below the base rate, unissued VP stay unissued as in the original v2 rule. Splitting that account across rooms changes only the receipt breakdown and may leave extra integer remainders.

First five accepted messages: weight 1 each. Next five: weight 0.5 each. Maximum weight = 7.5 per account per round. All room limits are global to the account. Deletion before closure removes contribution but preserves the used slot; deletion after closure never changes finalized awards. Short messages remain ordinary chat messages. Exact/numeric duplicate checks, seven-day recent fingerprints and five-minute / eight-hourly limits reduce repetitive farming. They do not guarantee semantic relevance or prevent colluding accounts.

## Qualification and planned transferable NFTs

One X identity activates once. Three different UTC contribution days in settled rounds qualify the account for the community milestone count. Current-round unique participants determine fund release independently of qualification. No IP-based bans or claims of unique human verification.

Event editions correspond to 100 / 250 / 500 / 1,000 / 2,000 / 5,000 / 10,000 qualified accounts. Base event retention is 0.85^missing editions. Holding an edition restores its corresponding reduction. The full planned multiplier is that retention plus sum(quantity held × bonus per NFT of that edition). Copies from the same edition stack. There is no personal multiplier ceiling or per-account NFT holding cap: 500% means 5× reward weight. The NFT bonus schedule is intentionally unconfigured and the calculator rejects a held eligible edition without an explicit rate. The user's 10 NFTs / 500% example is hypothetical, not an announced schedule.

A later verified snapshot must provide quantities per edition, including duplicate holdings. Coefficients and weighted receipts use unbounded whole numeric values in PostgreSQL and BigInt for calculations, without rounding to JavaScript Number before distribution. All awards stay within the existing shared fund through a common global denominator. The numerator and denominator use the same frozen per-round multipliers, across all rooms.

Real contract, chain, wallet binding and ownership verification are NOT enabled. All v2 round coefficients are currently 100%. The stored account-round row is an immutable calculation record, not ownership evidence. Before activating reductions, an on-chain adapter must:

- Accept only an announced chain and contract, verified token editions and a finalized common block at or before round start.
- Bind a signed wallet to one X account with history and effective round boundaries; include every eligible copy in its holdings. Disallow one wallet/token benefiting multiple X identities in one round; transferred tokens cannot gain another beneficiary in that round.
- Snapshot ownership independently of when a user sends their first message. No client-supplied holding lists, live mid-round checks or mutable retroactive coefficients.
- Verify resale/transfer, missing/burned editions, finality and provider failures. Pause reductions for an unavailable snapshot; do not penalize users for infrastructure failures.
- Announce actual prices, supplies, metadata and activation date separately before any production NFT operations.

## Scheduling and receipts

Six distinct daily cron paths share one secret-protected settlement handler. Hobby timing is within each scheduled hour, not guaranteed at the exact boundary. Active readers can close due windows sooner. Authenticated scheduler completions and pending counts appear in admin. Payout rows, window locking, pool constraints and reveal receipts enforce idempotence. Manual cron calls do not bypass database time or alter finalized windows.

## Verification

PGlite tests cover v1 preservation, v2 fund release and weighted division, cross-room caps, duplicate controls, three-day qualification, planned coefficient arithmetic, season limits, promotion isolation, repeat migrations and cron/reveal idempotence. Browser fixtures are local-only and excluded from deployment. Production verification uses read-only summaries and never fabricates real member activity.
