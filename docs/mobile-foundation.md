# VYX client foundation

The current release is a responsive website. It does not include App Store or Google Play builds.

## Shared interface

- Chats are the default screen. Desktop keeps a room directory alongside the conversation; mobile shows these as separate screens with an explicit back action.
- Rooms and DMs share the same visual frame. Existing X authentication, membership checks, replies, mentions, pins, message deletion and account-scoped read positions remain server enforced.
- Feed is a separate content-first view. Rewards, collection and settings are secondary destinations.
- In-page room, DM and post drafts survive navigation. Drafts are cleared on sign-out; this is not offline or persistent draft storage.
- Responsive layout uses dynamic viewport height and safe-area insets. Platform keyboard behaviour still needs physical-device testing.

## Home-screen metadata

`public/app.webmanifest` declares the VYX name, standalone display mode, scope, start URL, shortcuts and 192/512px application icons. Apple home-screen metadata is included in HTML. Browser/OS installation was not exercised automatically. There is no service worker, offline queue or cache of authenticated responses.

Manifest reference: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest

## Native application work to plan separately

1. Select a native client stack and extract reusable typed API contracts from the existing REST endpoints.
2. Implement and test platform-specific X sign-in callbacks, deep links and secure credential storage. The website currently authenticates with an HttpOnly session cookie.
3. Add an explicit notification permission and push subscription flow; notification inbox events currently live inside VYX.
4. Test keyboard, focus, background/foreground transitions, accessibility and weak networks on real iOS/Android devices.
5. Prepare signed builds, account/data controls and store submissions.

Room polling (10 seconds), directory refresh (15 seconds) and DM polling (15 seconds) remain the current transport. This release does not claim WebSockets, end-to-end encryption or native push delivery.
