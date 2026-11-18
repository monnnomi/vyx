# Quest verification recovery — 17 November 2026

At inspection the VPS, nginx and scheduled quest worker were running. Main state API returned 200 and the existing owner could open the Russian admin dashboard. The November 15 failure window contained PostgreSQL `42P01` (undefined relation) errors; the old logs did not include the relation name, so the exact historic cause is unconfirmed. There was no current disk or memory shortage.

Quest checks had last completed on November 14. There were no active two-hour grants, no November 17 allowance spending, and the owner's confirmed 8,500 VP remained intact. Pending cards still showed a November 13 daily-limit error after the allowance reset. The production OAuth Client ID did not match the existing VYX Social app, and the local migration copies lacked complete live OAuth credentials. A fresh connection attempt failed on X before consent. Restore the existing app's actual Client ID and full Client Secret only in the private server configuration; do not rotate keys automatically or publish them.

The fix keeps read-only scopes, two-hour grants, promotion accounting, task IDs, evidence checks and the separate $1/day limit. It displays reconnection instructions for an expired grant, clears obsolete daily-limit display errors after UTC reset without rewriting historical checks, and offers a connect-and-check link on every pending task. The existing OAuth return flow checks pending actions automatically after reconnection.

Deployment now validates OAuth credential shape before changing the running release and checks both the quest metadata endpoint and main state API after startup. It does not accept placeholder/masked credentials or log their values. No new identity provider, admin, scope or background News collection is enabled.

A real end-to-end X verification remains dependent on restoring valid credentials and obtaining the owner's normal read-only connection. Do not call a fixture test or deployed UI a confirmed live award. Never create synthetic production proofs or manually mark pending tasks complete.

## Applied result

The owner supplied complete credentials through a loopback-only password form. Only `X_CLIENT_ID` and `X_CLIENT_SECRET` were restored in `/etc/vyx/vyx.env`; the previous configuration has a root-only backup. Temporary input copies were removed and the input server stopped. The fix was pushed as `7f8b24d` and deployed in `/opt/vyx/releases/20261117T072327Z`. All 301 tests passed. Live state and tasks returned HTTP 200, the owner's admin dashboard loaded, and an OAuth retry reached the correct VYX Social consent screen for @monnnomi_. The scope remained read-only with a two-hour grant. No paid verification or extra production reward had occurred at this checkpoint: the final owner consent was still pending. Existing 8,500 VP were preserved.

## Provider rejection diagnosed — 18 November

The owner reported authorizing, but the database still had no new login, verification grant or task receipt. Callback logs recorded HTTP 502 failures. A bounded token-endpoint client-authentication probe (deliberately invalid authorization code; no user data or token printed) returned HTTP 401 `unauthorized_client` / `Missing valid authorization header`. This confirms the candidate Client Secret is not accepted for the configured app; reaching consent alone had not verified the secret. No extra task VP were issued. The developer-console credit balance was $4.45, so depleted credits were not the observed blocker.

A replacement loopback-only input form validates candidate credentials with X before persisting them. Only a provider response identifying an invalid authorization code after client authentication is accepted. It then applies just the two OAuth fields on the existing VPS, restarts the existing service and presents the owner with a fresh OAuth link. The owner must regenerate/enter the correct OAuth 2.0 Client Secret and personally submit any X consent. OAuth 1.0 Consumer Secret and app-only Bearer Token cannot substitute. At this checkpoint that owner action was pending; the existing 8,500 task VP and the $1/day cap remained intact.
