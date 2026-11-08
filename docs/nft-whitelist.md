# NFT whitelist

The public page is `/#whitelist`, available from More, the leaderboard tabs and the owner's NFT progress card. It follows the existing light and graphite themes and keeps Quests in the primary navigation.

`GET /api/vyx?action=whitelist&tier=all&page=1` returns up to 50 qualified public profiles. Filters are `all`, `free` and `half-price`. Global tier counts and filtered pagination totals come from the same database query.

- 50,000+ confirmed lifetime VP and at least three registered referrals: Free NFT.
- 50,000+ confirmed lifetime VP with fewer than three registered referrals: 50% off.
- Other accounts are not listed. System accounts and accounts without an X identity are excluded.

The query reuses `nftSelectionTotalsSQL`, the same basis as private profile progress and admin selection. Ledger rewards, including X task awards, count; estimates do not. Accounts automatically move to the free tier once the referral requirement is met and cannot appear in both tiers. This is current eligibility, not a frozen allocation or a mint receipt. Minting remains unavailable.

Public member fields are limited to `id`, `name`, `handle`, `avatar_url` and `tier`. Detailed progress, exact VP/referral deficits and invited identities remain private. Existing public profile/search/referral responses are unchanged. The owner's banner reads only their existing private selection endpoint; stale responses are discarded after an account change.

The page refreshes while visible every minute and supports manual refresh. It reads the existing database and makes no X API requests. No schema migration or stored reward changes are required.

Validation covers qualification boundaries, private-field exclusion, guest access, tier filtering and validation, automatic upgrades, lifetime ledger updates and pagination. Browser checks use isolated fixtures with one free, one discounted and one unqualified account; production lists contain real accounts only.
