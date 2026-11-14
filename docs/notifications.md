# In-app notifications

VYX shows new follows, post likes, post replies, incoming direct messages, room mentions and finalized room drops across its signed-in pages. Public UI remains English. Notifications never award VP or call X/AI services.

- A private inbox refresh runs every five seconds in a visible tab and every twenty seconds in the background. Network failures back off to sixty seconds. Returning online or to the tab refreshes sooner. This is in-app delivery while VYX is open, not OS push after the site is closed.
- The first successful snapshot establishes a quiet baseline. Existing unread events update the badge without replaying old pop-ups. Navigation does not restart this baseline.
- Desktop Activity and the mobile navigation show the total unread count, including events beyond the latest fifty displayed. Unchanged snapshots return an account-specific ETag/304 response with no notification body.
- Up to three clickable cards appear at once. They dismiss after ten seconds, except while hovered or keyboard-focused. A close button does not mark the event as read. Motion preferences, light and dark themes are respected.
- Opening an event marks only that event as read and navigates to its profile, post, direct conversation, room or drop. Mark all read acknowledges only the displayed snapshot cutoff. Direct messages also become read when the existing visible-dwell message-view receipt is recorded.
- Inbox content and reads are recipient-only. Block/mute controls, room membership, room mutes, deleted content and category preferences are enforced by server queries. New likes/messages preferences default on; older clients saving the four original categories preserve the new preferences.
- Visible browser windows share a Web Lock and a bounded local list of shown event IDs to avoid repeating pop-ups. No message previews are stored there. Account changes clear pending cards and cancel old requests.

## Database and deployment

`server/notification-schema.sql` adds two preference columns, individual notification read receipts and recipient indexes. It is included in `db/schema.sql` for isolated fixtures. `scripts/migrate-notifications.mjs` applies only this additive migration; the VPS deployment runs it before switching releases. Existing content, VP, preferences and the previous release remain compatible. No credentials or test fixtures are deployed.

## Validation

`test/notifications.test.mjs` covers recipient isolation, like/message delivery, self-exclusion, message view receipts, per-event reads with PostgreSQL sub-millisecond timestamps, refollow/re-like version handling, read-all cutoff, unread counts beyond fifty events, mute/block/category filtering, deleted posts, old-client preference compatibility, authenticated conditional HTTP responses, CSRF, repeatable migration, quiet client initialization, deduplication, hidden-tab queuing, stale snapshots and account changes.

Browser QA uses only the disposable `test/browser-server.mjs` database and QA Alice/QA Bob. No synthetic production notifications are created. Use the ordinary VPS publication workflow in `zomro-hosting.md`; Git push alone does not publish the site.
