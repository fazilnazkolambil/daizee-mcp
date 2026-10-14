# daizee-mcp

**A health memory that lives in the service, not in the assistant.**

Tell any voice assistant once that you're allergic to peanuts, and every meal you log afterwards, even in a brand-new conversation, is checked against it. Tell it your knee is sore and it remembers for about a week, checks in before the note expires, then lets it go.

`daizee-mcp` is an [MCP](https://modelcontextprotocol.io) server (Model Context Protocol, the standard way an AI assistant calls outside tools). It is built for the Amazon Developer Hackathon, Alexa+ track, and it exposes the memory and meal-logging ideas from DayZer0, a live Android AI health-coach app.

> **Honest status:** this is a *simulated* Alexa+-style integration. Amazon's real Alexa+ add-on tooling is limited to select partners, so nothing here has been tested on a real Alexa device and nothing is Alexa-certified. The server follows Amazon's public design guidance, and a demo page (in progress) acts as a real MCP client to show it working.

## Quick start (no accounts, no keys)

```bash
git clone <this repo>
cd daizee-mcp
npm ci
npm test        # 66 checks, including real MCP calls over HTTP
npm start       # MCP server on http://localhost:8787/mcp
```

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
- **Memories expire on purpose.** An allergy lasts about a year, a sore knee about 5 days, unless the user says otherwise. Repeating a fact refreshes it instead of duplicating it. Allergies are always shown first.
- **A conscience in the tools, not the prompt.** `log_meal` returns `safetyFlags` that name the memory that triggered them. The check matches words, so it can miss things: it is a reminder, never medical advice.
- **Safe writes.** Logging the same meal twice never double counts. `resolve_memory` always asks first, and is extra careful with allergies.
- **Voice-shaped replies.** Every reply has a short plain-text `spoken` sentence (at most 75 words, no markdown) plus structured data for a screen.

## Where the required technology runs at runtime

| Piece | File |
|---|---|
| MCP server built with the official SDK (`McpServer`, `registerTool`) | [`src/server/mcpServer.ts`](src/server/mcpServer.ts), [`src/server/tools.ts`](src/server/tools.ts) |
| Streamable HTTP transport, stateless, one server per request | [`src/server/http.ts`](src/server/http.ts) |
| A real MCP client (`Client` + `StreamableHTTPClientTransport`) driving it end to end | [`tests/contract.test.ts`](tests/contract.test.ts) |
| A real trace of those calls, written by the test run | [`docs/WIRE_TRACE_SAMPLE.jsonl`](docs/WIRE_TRACE_SAMPLE.jsonl) |

The server negotiates MCP protocol versions `2025-11-25` and `2025-03-26` (Amazon's own docs show both), and declares only what it honors (the tool list is fixed). The newest published MCP revision is `2026-07-28`; this server targets `2025-11-25` through SDK 1.x, which satisfies the hackathon's "2025-11-25 or later".

## Real vs simulated

| | Status |
|---|---|
| MCP server, tools, memory rules, safety check | **Real**, tested |
| Streamable HTTP, protocol negotiation, Origin check | **Real**, tested |
| Storage | **In-memory demo data**. A Firebase store plugs into the same interface later |
| Alexa+ itself | **Simulated.** No real Alexa device or Amazon tooling used |
| Account linking / OAuth | **Not built.** A demo header picks the user. A real deployment would link the user's existing Daizee account |
| Demo page with voice and live wire trace | **In progress** |

## How it is organized

```
src/memory/   The memory rules (pure functions, no imports from the rest of the project)
src/store/    Where data lives (swappable)
src/server/   The six actions and the web doorway
seed/         Fictional demo people, a small food table, allergy keyword rules
tests/        Memory rules, behaviour, and real MCP over HTTP
docs/         Update story, friction log, wire trace
```

## Provenance

The memory rules were **ported** from the DayZer0 app's memory store (`functions/src/services/memory/memoryStore.js`, first added 2026-09-23): priority order, expiry table, duplicate handling, confidence gate, 3-change cap, one-day grace for resolved notes. The router and coach prompts of the app are not part of this repo. See [`docs/SIGNIFICANT_UPDATE.md`](docs/SIGNIFICANT_UPDATE.md).

## License

MIT
