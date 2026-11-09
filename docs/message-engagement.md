# Message views and reactions

Rooms and direct messages show an aggregate unique-view count beside the reaction controls. Counts begin at rollout; existing messages gain views when members actually view them after release. Prior read cursors are not used as historical proof.

The browser qualifies a message after at least one second with at least half its visible area on screen (or half the available log height for very tall messages). Off-screen messages, background tabs, modal overlays and the author's own messages do not qualify. Dwell resets on scrolling away, hiding the tab or changing account/context. Posting and reaction controls continue to work independently of view recording.

`POST /api/vyx?action=message-views` accepts `kind` (`room` or `dm`), the conversation `id`, and up to 60 `messageIds`. The session supplies the viewer identity. Same-origin requests, authenticated X accounts, current membership, unarchived rooms, message visibility and DM participant access are required. Mixed invalid batches fail atomically. The route has its own 40-batch/minute per-account limit so read receipts do not consume the message-writing allowance.

`message_views` records the first view time once per account/message. The sender is excluded. Shared locks follow the existing user-before-room order and prevent a concurrent leave/close/delete from invalidating authorization mid-write. The message APIs return only `view_count` and the current member's own `viewed_by_me`, never a reader identity list. Unique constraints prevent duplicate counts across refreshes, tabs and devices. Counts remain after a viewer leaves; they disappear with hard-deleted messages. Views have no VP or farming effect and do not call X API.

Reactions expand from six to 24 emoji, retaining the original six. Each member still has one reaction per message, which can be replaced or removed. Client choices, server validation and the database constraint are checked for consistency.

Apply `node --env-file=.env.local scripts/rollout-message-engagement.mjs --apply` before deploying code that reads `message_views`. The migration is repeatable and validates that existing accounts, messages, reactions, view records, reward records, VP totals and pool spend are unchanged. The expanded emoji check accepts all previous stored reactions.

Validation covers no side effects from GET requests, unique counts, sender exclusion, private room/DM access, mixed batches, mute/block/delete/close handling, CSRF, input bounds, reaction changes, rerunning the migration, visible dwell, scrolling, tall messages, account switches, batching and error backoff. Browser QA uses isolated test accounts, not fake production readers.

## Post views

Post cards in the feed, author profiles, search, saved posts and discussion overlays share one unique count. Signed-out visitors can read public totals; only signed-in X accounts can add a receipt, once per post and excluding its author. Visible dwell and background-tab rules match message views. When a modal is open, only posts inside that modal qualify, never the covered feed. All surfaces for an account share acknowledgement state. Neither fetching posts nor opening a link by itself records a view.

`POST /api/vyx?action=post-views` accepts up to 60 `postIds`, uses the session identity, rejects hidden/deleted/nonexistent posts atomically and has a separate 40-batch/minute allowance. It returns only aggregate counts and the caller's own status. Public feed queries expose those same fields without reader identities. The additive `post_views` table does not change message receipts or VP. Apply `node --env-file=.env.local scripts/rollout-post-views.mjs --apply` before deployment. This migration validates preservation of existing content, likes, comments, message views, reactions and VP totals. Historical views are not backfilled.
