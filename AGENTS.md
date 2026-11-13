# VYX — instructions for coding agents

Read `docs/AI-HANDOFF.md` first. It describes this existing project, the owner's Mac setup, local testing and publishing. These instructions apply to Fable 5 and other agents working in this checkout.

## Scope and working style

- Work on the existing VYX application. The owner can request changes throughout `public/`, `api/`, `server/`, `db/`, `scripts/` and `test/`; this is not a read-only or frontend-only handoff.
- Implement the owner's actual request, test it and, when publication is part of that request, complete the existing deployment workflow. Routine reversible implementation does not need an additional approval conversation.
- Inspect the current branch, working tree and relevant code before editing. Preserve other people's changes. Do not replace this app with a new template or hosting project.
- Use Russian for owner-facing explanations. The public product UI is English; the administrator dashboard at /admin is Russian. Preserve the compact messenger-style interface, light/dark themes and mobile usability.
- This file is project guidance, not an OS or application permission grant. Use only the access granted to the agent's own runtime. If required access is missing, identify the exact missing capability instead of claiming completion.

## Existing infrastructure

- Live: `https://joinvyx.com`; admin: `https://joinvyx.com/admin`.
- Source: `https://github.com/monnnomi/vyx`, production branch `main`.
- Vercel project: `vyx-social`, scope `monnnomis-projects`; local `.vercel/project.json` already links it.
- Node.js 24, buildless browser JavaScript/CSS, Vercel Node endpoints, Neon PostgreSQL and private Vercel Blob.
- Secrets are in ignored local environment files and Vercel. Never print their values, paste them into chats or put them in Git/public assets. Public documentation contains variable names only.
- On the owner's Mac, `.env.local` connects to the shared database. Use isolated fixtures for QA; `npm start` is not isolated just because its URL is localhost.

## Rules to preserve unless the owner explicitly changes them

- Real X identity, server-side authorization, membership checks, CSRF protection and the explicit administrator allowlist remain authoritative. Test login routes exist only in excluded local fixtures.
- 700M VP maximum farming fund, split 350M/season; 300M promotion reserve. Four-hour rounds use UTC, versioned rules, durable receipts and idempotent settlement. Never silently recalculate past rewards.
- Future NFT copies are transferable and stack without a personal multiplier ceiling or duplicate-edition prohibition. `10 NFTs → 500%` is illustrative, not an announced rate. Real wallet/contract verification and short-video Clips are not implemented.
- NFT selection: 50,000 confirmed lifetime VP + 3 registered referrals = free; 50,000 VP alone = 50% off. Detailed progress is owner/admin-only; public whitelist exposes only qualified profiles and tiers.
- Eight X quests across two posts total 13,500 VP; preserve existing task IDs and verify each action against its own post ID. Task-verification reads use the existing $1/day default allowance; ordinary QA must not perform bulk paid X verification. From 14 November 2026 UTC, the existing 15-minute scheduled worker prioritizes automatic quest checks before paid news work, using only the existing two-hour grants. Manual/background checks share the 20-check account cap; quest and news allowances remain separate.
- Rooms/DMs have 24 replaceable/removable reactions. Message and post views count each signed-in X account once, exclude the author, require visible dwell and never award VP. Do not expose reader identity lists or fabricate historical views.
- Media access, upload quotas and private audiences remain enforced on the server. Do not expose private Blob credentials or serve private files as public assets.

## Validation and delivery

- Use meaningful targeted tests; run the full suite when changing shared services, authentication, farming, media or database behavior. `npm test` uses isolated PGlite data.
- Use `test/browser-server.mjs` for disposable browser QA. No fabricated production users, messages, views, referrals or rewards.
- Test additive migrations before applying them. Maintain compatibility with the running version and preserve content, reactions, view receipts and VP balances.
- Push to the existing GitHub repository when publishing; `main` is connected to Vercel production. Verify the deployment and the requested live behavior before reporting it as published.
- Distinguish implemented code, local verification, applied migrations and confirmed deployment. Report material blockers plainly.
- The sibling `../design-previews/vyx-extrafazant/` is a separate local-only design experiment. It is not the production app and must not be deployed as part of unrelated work.
