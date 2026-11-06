# VYX analytics and custom domain

All three integrations belong to the existing VYX project. Keep these counters when moving to a custom domain; do not create replacement counters.

- GA4 property: **562276552**; VYX Web stream: **16267886800**; measurement ID: **G-H4RVWMN67F**. Yandex counter: **114067415**.
- Public counter IDs: `analytics-settings.json`; optional Vercel environment overrides: `GA4_MEASUREMENT_ID`, `YANDEX_METRIKA_ID`.
- `scripts/build-analytics.mjs` generates `public/analytics-config.js` at deployment. Tracking is enabled only for production. Local and preview deployments are disabled.
- `public/analytics.js` waits for the visitor's choice before loading all three vendors, measures a fixed list of sections, strips query parameters, sends no room/person/post/receipt IDs, and uses the current origin automatically.
- Analytics choice is saved per browser/origin; Settings → Analytics allows changing it. The admin and OAuth pages do not load analytics.
- GA4 enhanced measurement is disabled. The app sends manual page views. Do not enable automatic form/link/history tracking without reviewing privacy and duplicate views.
- Yandex Webvisor and app-side automatic link/form/click tracking are disabled. A same-counter address allowlist is enabled in Yandex.
- Vercel Web Analytics uses the existing Hobby allowance. Current limit: 50,000 events/month shared across the team and one month of viewable history. No paid upgrade was requested.

## When the user provides the purchased domain

1. Add and verify it in the existing Vercel `vyx-social` project. Update DNS at the registrar using Vercel's current instructions. Wait for DNS and TLS readiness; timing depends on the provider.
2. Choose the canonical domain and redirect its www/apex alternative and the old Vercel alias to it only after testing. Do not remove the working old host early.
3. Update `PUBLIC_APP_URL=https://NEW_DOMAIN` in the Vercel production environment and add `https://NEW_DOMAIN/api/auth/callback/x` to the existing X app callback allowlist. Keep the old callback during migration. Redeploy and verify X sign-in and same-origin requests.
4. GA4: edit the website URL on the existing **VYX Web** stream. Keep its measurement ID and resource. Add old/new domains in cross-domain settings only if both remain separately navigable and session linking is needed; a redirect-only migration does not require a replacement stream.
5. Yandex: change the site address on counter **114067415**, add the new host and required www alternative to its allowed addresses. Keep the previous alias temporarily if it remains usable. Keep the counter ID unchanged.
6. Vercel: analytics stays on this project and its new hostname; no new installation is needed. Select the desired hostname in reports.
7. Verify a real visit and section navigation on the new host after allowing analytics, check all three reports, HTTPS redirects, OAuth, rooms and admin access. Old analytics history remains in the same counters, subject to each service's retention limits. Analytics cookies/consent and the VYX login cookie do not automatically move between unrelated domains; users may need to sign in and choose analytics again.

No source-code replacement or analytics reinstallation is needed merely to change the domain. DNS, ownership verification, provider settings and X callbacks are separate steps; do not promise a literal two-click or instant migration.
