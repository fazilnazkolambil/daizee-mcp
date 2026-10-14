# daizee-mcp

**A health memory that lives in the service, not in the assistant.**

Tell any voice assistant once that you're allergic to peanuts, and meals you log afterwards, even in a brand-new conversation, are checked against it. Tell it your knee is sore and it remembers for about a week, checks in before the note expires, then lets it go.

> **How far the meal check goes:** it matches words against a built-in list of common allergens and diets (peanuts, tree nuts, dairy, eggs, gluten, shellfish, fish, soy, sesame, vegetarian, vegan, pork, beef). It can miss things, so an empty result is not a clearance. When you save an allergy or diet the list doesn't cover, the service says so out loud instead of staying quiet. It is a reminder, never medical advice.

`daizee-mcp` is an [MCP](https://modelcontextprotocol.io) server (Model Context Protocol, the standard way an AI assistant calls outside tools). It is built for the Amazon Developer Hackathon, Alexa+ track, and it exposes the memory and meal-logging ideas from DayZer0, a live Android AI health-coach app.

> **Honest status:** this is a *simulated* Alexa+-style integration. Amazon's real Alexa+ add-on tooling is limited to select partners, so nothing here has been tested on a real Alexa device and nothing is Alexa-certified. The server follows Amazon's public design guidance, and a demo page acts as a real MCP client to show it working.

## Quick start (no accounts, no keys)

```bash
git clone https://github.com/fazilnazkolambil/daizee-mcp
cd daizee-mcp
npm ci
npm test        # automated checks, including real MCP calls over HTTP
npm run demo    # builds the demo page and serves everything on http://localhost:8787
```

Open <http://localhost:8787>. With no keys the page runs in **replay mode**: the assistant's decisions are scripted, but every call to the service is real MCP and the trace panel shows the actual JSON. Try the suggested phrases ("More ideas" shows the rest), press **New conversation** to see memory survive a fresh assistant, and **Advance time** to watch notes age. The "Yes, forget it" phrase only works right after "My knee is better now": the service enforces that it must ask first.

`npm start` runs only the MCP server (no page).

**Hosted demo:** <https://daizee-mcp-demo.web.app> runs the same code on Firebase (Hosting plus one Cloud Function, with the Gemini key in Secret Manager). It uses fictional data only. State lives in one server instance's memory and is shared by everyone, so it resets when the instance restarts; use **Reset demo** at any time. The MCP endpoint is `https://daizee-mcp-demo.web.app/mcp`. The `deploy` script and `firebase.json` are in this repo, and they target only that demo project.

Try it with the official MCP Inspector (pin the version, it needs Node 22.19+):

```bash
npx @modelcontextprotocol/inspector@2.10.1 --cli --transport http \
  --server-url http://localhost:8787/mcp --method tools/list
```

Or with plain `curl`:

```bash
curl -s -X POST localhost:8787/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'mcp-protocol-version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"recall_what_you_know","arguments":{}}}'
```

Two **fictional** demo people are built in: `maya` (has history) and `sam` (blank). Choose with the `x-daizee-user` header. All data is invented.

## The demo page

A generic "voice assistant" screen (no Amazon or Echo logos) that is a **real MCP client**: the official SDK's `Client` + `StreamableHTTPClientTransport`. It shows:

- the live wire trace: `initialize`, `tools/list`, `tools/call`, with status, round-trip time and the server's own time against the 500 ms target
- cards drawn from the structured data (calorie ring, memory chips with lifespan bars, safety banners)
- **New conversation**: wipes the assistant's own history and opens a brand-new MCP connection. The service still remembers.
- **Advance time**: moves a demo clock forward so you can watch a note age, raise a check-in, and expire
- **voice in:** the page records the microphone, converts it to a 16 kHz mono WAV in the browser, and POSTs it to `/brain/transcribe`, where Gemini transcribes it (this replaces the browser's own Web Speech recognition, which needs Google's servers and fails on some networks). Near-silent recordings are caught by a silence gate before any model call, because the model invents text for silent audio; steady background noise can still make it invent words, so the page always shows what it heard before acting. The transcription prompt includes the service's own vocabulary (dish names, allergy terms) to help with words like "pad thai". Typed input always works.
- **voice out:** the browser's own speech synthesis (the "Speak replies" switch in Settings).

**Two assistant modes.** *Replay* (default, no keys): scripted "which tool should I call" decisions, real calls, and the real service's replies. *Live*: Gemini decides which tool to call. To enable it, copy `.env.example` to `.env` and set `GEMINI_API_KEY` (the file is git-ignored). The key stays on the server, and the browser never sees it. The live brain lives in `src/brain/` and is **separate from the MCP server**, which still contains no language model.

The default model is `gemini-3.1-flash-lite` (older ids such as `gemini-2.5-flash` are retired for new keys). Free Gemini keys allow about 15 requests a minute, so the brain waits out short limits and retries once.

**Measured tool choice.** With the server running and a key set, `npm run eval:live` sends 12 spoken phrases through the real loop (Gemini picks tools, the real MCP server runs them) and writes [`docs/EVAL.md`](docs/EVAL.md). Cases include a two-step forget, an allergy flag after a fresh conversation, a weight that must not be spoken aloud, an off-topic joke, and a prompt-injection attempt. The author wrote the phrases, so treat the result as a smoke test, not a benchmark.

## What it does: six actions

| Action | What the assistant uses it for |
|---|---|
| `get_day_progress` | "How am I doing today?" Calories and macros vs goal, plus check-ins for notes about to expire |
| `log_meal` | "I had two idlis and sambar." Logs it, and warns if it conflicts with an allergy or diet |
| `remember_about_user` | "I'm allergic to peanuts." / "My knee is sore this week." |
| `recall_what_you_know` | "What do you know about me?" Allergies always come first |
| `resolve_memory` | "My knee is better." Two steps: it asks, then forgets only after a yes |
| `log_weight` | One weigh-in a day. The number is never spoken aloud |

Design choices, each tested:

- **No language model inside the server and no "chat with me" action.** The assistant does the talking and understanding. Amazon's Alexa+ policy rejects add-ons that just relay chat to another AI, and every call stays fast and predictable.
- **Memories expire on purpose.** An allergy lasts about a year, a sore knee about 5 days, unless the user says otherwise. Repeating a fact refreshes it instead of duplicating it. Allergies are always shown first, and an allergy is checked in on during the last 30 days of its life so the safety net never drops silently.
- **A conscience in the tools, not the prompt.** `log_meal` returns `safetyFlags` that name the memory that triggered them. The check matches words, so it can miss things: it is a reminder, never medical advice.
- **Safe writes.** Logging the same meal twice never double counts. `resolve_memory` always asks first, and the service itself enforces it: a "yes" with no earlier question changes nothing, and an old question expires after 10 minutes. It is extra careful with allergies.
- **Voice-shaped replies.** Every reply has a short plain-text `spoken` sentence (at most 75 words, no markdown) plus structured data for a screen.

## Where the required technology runs at runtime

| Piece | File |
|---|---|
| MCP server built with the official SDK (`McpServer`, `registerTool`) | [`src/server/mcpServer.ts`](src/server/mcpServer.ts), [`src/server/tools.ts`](src/server/tools.ts) |
| Streamable HTTP transport, stateless, one server per request | [`src/server/http.ts`](src/server/http.ts) |
| A real MCP client (`Client` + `StreamableHTTPClientTransport`) driving it end to end | [`tests/contract.test.ts`](tests/contract.test.ts) |
| A real trace of those calls, recorded by the contract test (regenerate with `npm run trace:update`) | [`docs/WIRE_TRACE_SAMPLE.jsonl`](docs/WIRE_TRACE_SAMPLE.jsonl) |

The server negotiates MCP protocol versions `2025-11-25` and `2025-03-26` (Amazon's own docs show both), and declares only what it honors (the tool list is fixed). The newest published MCP revision is `2026-07-28`; this server targets `2025-11-25` through SDK 1.x, which satisfies the hackathon's "2025-11-25 or later".

## Real vs simulated

| | Status |
|---|---|
| MCP server, tools, memory rules, safety check | **Real**, tested |
| Streamable HTTP, protocol negotiation, Origin check | **Real**, tested |
| Storage | **In-memory demo data**. A Firebase store plugs into the same interface later |
| Alexa+ itself | **Simulated.** No real Alexa device or Amazon tooling used |
| Account linking / OAuth | **Not built.** A demo header picks the user. A real deployment would link the user's existing Daizee account |
| Demo page with live wire trace, cards, voice, replay mode | **Real**, a simulation of the assistant side |
| Live Gemini brain | **Optional**, needs your own key |

## How it is organized

```
src/memory/   The memory rules (pure functions, no imports from the rest of the project)
src/store/    Where data lives (swappable)
src/server/   The six actions and the web doorway
src/brain/    The demo page's assistant brain (Gemini). NOT part of the MCP server
simulator/    The demo page (Vite + TypeScript)
seed/         Fictional demo people, a small food table, allergy keyword rules
tests/        Memory rules, behaviour, and real MCP over HTTP
docs/         Update story, friction log, wire trace
```

## Provenance

The memory rules were **ported** from the DayZer0 app's memory store (`functions/src/services/memory/memoryStore.js`, first added 2026-09-23): priority order, expiry table, duplicate handling, confidence gate, 3-change cap, one-day grace for resolved notes. The router and coach prompts of the app are not part of this repo. See [`docs/SIGNIFICANT_UPDATE.md`](docs/SIGNIFICANT_UPDATE.md).

## License

MIT
