# VYX newsroom

Members read English-language articles and project reviews in `/#news`. Story links use `/?story=<uuid>#news`. Archived briefs keep their historical byline, source, photos and comments.

Members of the existing VYX admin allowlist can publish immediately under the VYX byline. In `/admin#admin-news`, enter a member's exact VYX handle to grant publishing access. The member can then open News, select **Write a story**, choose a category and publish under their own name. The source link is optional. Edits retain the original link and discussion.

Active contributors may edit and unpublish their own articles. Administrators can edit human-authored articles and unpublish any article. Revoking access immediately prevents new publications and edits by that contributor. Their existing published articles remain readable. Stories do not award VP.

The Zomro deployment applies `db/manual-news.sql` transactionally before switching releases. The previous news scheduler URL remains for installed timers and runs only automatic X quest verification. News does not contact X or AI services. Historical collector fixtures in the test directory are excluded from deployments.
