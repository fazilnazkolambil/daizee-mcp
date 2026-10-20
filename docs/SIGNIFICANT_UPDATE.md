# What was new for this hackathon, and what was not

This file is written from `git log` facts so it can be checked. Nothing here is backdated or squashed. The commit timestamps are the real ones; several local commits were made in batches, so some share a second.

## Disclosure first

DayZer0 is an Android health-coach app that I also entered in **Shipaton 2026** on 2026-09-30 (app repo commit `dff3530`). This Amazon entry is a **separate, newly created open-source project**, `daizee-mcp`, first commit on **2026-10-14** (see this repo's history). It reuses ideas from the app and connects to it conceptually; it does not contain the app.

## Layer 1: the app before the submission period (baseline)

App repo commit `0855abf`, 2026-08-30 (version 1.0.2+7): a dashboard-first app with a text-only Q&A chat, a router/coach split, and create-only expiring memories (`memoryWriter.js`, added 2026-08-10, plus `pickExpiringMemories`, added 2026-08-24). The submission period opened 2026-08-31.

Not part of that baseline: the full memory engine with priority ordering, duplicate handling and update/resolve (`memoryStore.js`, added 2026-09-23) and the Memories page (2026-09-24).

## Layer 2: the app's update inside the period (also part of the Shipaton entry)

From `0855abf` to the Shipaton entry commit `dff3530` (2026-09-30): 24 commits, 345 files changed, +30,356 / -6,127 lines. Chat became the home screen, Daizee gained meal / photo / weight actions with undo cards, a daily plan, the Memories page, subscriptions and account deletion.

**This work was already part of the Shipaton entry.** It is context here, not the new work. Three app commits came after the Shipaton entry (`7e54740` and `d3ef956`, an in-app update dialog and version bump, and `fcd4434` on 2026-10-14); to `HEAD` the app diff is 27 commits, 421 files, +37,164 / -6,176.

## Layer 3: new for this hackathon (this repo only)

Built from 2026-10-14 in `daizee-mcp`:

- An MCP server (official SDK, Streamable HTTP, stateless) with seven voice-shaped actions, including `get_today_plan` (read only: the app's daily focus and eat / move / recover steps)
- A tested TypeScript port of the app's expiring, safety-first memory rules, behind a swappable store
- A Firestore store (`STORE=firestore`) that reads and writes the live DayZer0 app's data in the app's own document shapes, so a voice-logged meal or weigh-in is picked up by the app's existing triggers and shows up in the app. Reachable accounts are limited to an allowlist, a real project needs an explicit opt-in, and it is tested with a fake Firestore and in the Firebase emulator running the app's own `onMealWritten` / `onWeightLogWritten` triggers. The app's code was not changed for this
- Per-user auth in the shape Alexa+ account linking expects: with the Firestore store, `/mcp` requires a Firebase ID token from DayZer0's existing sign-in (checked with firebase-admin), the token's uid is the user, unauthenticated calls get `401` with `WWW-Authenticate`, and `/.well-known/oauth-protected-resource` (RFC 9728) names the app's Firebase token issuer. The uid allowlist stays as an extra guard. The OAuth consent screen for Alexa+ is not built
- An allergy / diet safety check on meal logging, with a controllable clock for demonstrating expiry
- Contract tests that drive the server with the real MCP client, and a recorded wire trace (regenerated with `npm run trace:update`)
- A demo page that acts as a real MCP client: live wire trace, cards, voice, a New-conversation proof and a time-advance control, with a replay mode and an optional live Gemini brain

**Before:** Daizee lived only inside one Android app, and you had to type.
**After:** the same kind of memory is a service any MCP assistant can call, so it survives a fresh conversation, and with the Firestore store a meal said to the assistant lands in the DayZer0 app itself.

## Not claimed

- Alexa+ certification, a real Alexa device, or any Amazon partner tooling
- Voice support inside the Flutter app: this entry adds none. The only app change near it is `fcd4434` (2026-10-14), made in the app repo before this work and unrelated to voice
- A full Alexa+ account-linking flow: the server checks DayZer0 Firebase ID tokens, but there is no OAuth authorization server (sign-in and consent page) for Alexa+ to send the user to. In-memory demo mode still picks a fictional user with a header
- A Play Store launch date (taken from Play Console, not from this document)
