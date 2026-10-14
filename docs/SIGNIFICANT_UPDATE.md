# What was new for this hackathon, and what was not

This file is written from `git log` facts so it can be checked. Nothing here is backdated or squashed.

## Disclosure first

DayZer0 is an Android health-coach app that I also entered in **Shipaton 2026** on 2026-09-30 (app repo commit `dff3530`). This Amazon entry is a **separate, newly created open-source project**, `daizee-mcp`, first commit on **2026-10-13** (see this repo's history). It reuses ideas from the app and connects to it conceptually; it does not contain the app.

## Layer 1: the app before the submission period (baseline)

App repo commit `0855abf`, 2026-08-30 (version 1.0.2+7): a dashboard-first app with a text-only Q&A chat, a router/coach split, and create-only expiring memories (`memoryWriter.js`, added 2026-08-10, plus `pickExpiringMemories`, added 2026-08-24). The submission period opened 2026-08-31.

Not part of that baseline: the full memory engine with priority ordering, duplicate handling and update/resolve (`memoryStore.js`, added 2026-09-23) and the Memories page (2026-09-24).

## Layer 2: the app's update inside the period (also part of the Shipaton entry)

From `0855abf` to the current app state: 26 commits since 2026-08-31, 396 files changed, about +36,100 / -6,100 lines (`lib/` 139 files, `functions/` 54 files). Chat became the home screen, Daizee gained meal / photo / weight actions with undo cards, a daily plan, the Memories page, subscriptions and account deletion.

**This work was already part of the Shipaton entry.** It is context here, not the new work.

## Layer 3: new for this hackathon (this repo only)

Built from 2026-10-13 in `daizee-mcp`:

- An MCP server (official SDK, Streamable HTTP, stateless) with six voice-shaped actions
- A tested TypeScript port of the app's expiring, safety-first memory rules, behind a swappable store
- An allergy / diet safety check on meal logging, with a controllable clock for demonstrating expiry
- Contract tests that drive the server with the real MCP client, and a CI-written wire trace
- A demo page that acts as a real MCP client: live wire trace, cards, voice, a New-conversation proof and a time-advance control, with a replay mode and an optional live Gemini brain

**Before:** Daizee lived only inside one Android app, and you had to type.
**After:** the same kind of memory is a service any MCP assistant can call, so it survives a fresh conversation.

## Not claimed

- Alexa+ certification, a real Alexa device, or any Amazon partner tooling
- Voice support inside the Flutter app (the app is unchanged by this entry)
- Account linking (a demo header picks the user)
- A Play Store launch date (taken from Play Console, not from this document)
