# Friction log

Only things that actually happened while building. Each entry: what was attempted, what happened, severity, workaround, suggestion. Nothing here is copied from documentation.

## 2026-10-14: MCP TypeScript SDK advertises `tools.listChanged` by default

- **Task:** Build a server whose tool list never changes (Alexa+ captures tools at deploy time).
- **What happened:** After `registerTool`, `initialize` advertised `capabilities.tools.listChanged: true` even though the server never sends the notification.
- **Severity:** Low (a small dishonesty in what the server declares).
- **Workaround:** After registering tools, set the flag to false on the server's internal capabilities object (a cast, because there is no public option).
- **Suggestion:** Let `McpServer` accept a `listChanged: false` option, or only advertise it once a tool is registered dynamically.

## 2026-10-14: A brand-new major TypeScript release did not match the surrounding tools

- **Task:** Pick toolchain versions from the npm registry.
- **What happened:** `npm view typescript version` returned a new 7.x major while the test and run tooling targets 5.x. I pinned `typescript@~5.9.3` to avoid an untested combination.
- **Severity:** Low.
- **Workaround:** Pin the 5.9 line.
- **Suggestion:** Tutorials that say "install the latest TypeScript" should name a tested version.

## 2026-10-14: `npm install` warns about unreviewed install scripts

- **Task:** Install dependencies on a fresh Node 26 machine.
- **What happened:** npm warned that `esbuild`'s postinstall script is not yet covered by `allowScripts`. Everything still ran.
- **Severity:** Low (noise that could worry a new user).
- **Workaround:** None needed.
- **Suggestion:** Document which install scripts MCP-adjacent tooling needs.

## 2026-10-14: A stateless server makes the browser console show a "405" on every connection

- **Task:** Connect a browser MCP client to a stateless Streamable HTTP server.
- **What happened:** After `initialized`, the SDK client always sends a `GET /mcp` to open an optional server-to-client stream. A stateless server correctly answers 405, but the browser console prints a red "Failed to load resource" line each time, which looks like a bug to a first-time reader.
- **Severity:** Low (cosmetic, but alarming).
- **Workaround:** Label the trace row "no stream offered: stateless server" and document it.
- **Suggestion:** A client option to skip the optional GET when the server is known to be stateless, or a response header that says so.

## 2026-10-14: `gemini-2.5-flash` returns 404 for a brand-new API key

- **Task:** Call Gemini from the demo backend with the model id from the documentation examples I had in mind.
- **What happened:** Every call returned HTTP 404 with "no longer available to new users". The model still appears in the key's own model list, which made the error look like a bug in my request.
- **Severity:** Medium (30+ minutes lost; 12 of 12 eval cases failed with an opaque message).
- **Workaround:** Ask the API which models actually work for this key and switch to `gemini-3.1-flash-lite`.
- **Suggestion:** Hide retired models from `ListModels` for new keys, or return a clearer error type than 404.

## 2026-10-14: Gemini invents a sentence for pure silence

- **Task:** Transcribe a silent recording (an empty microphone) with the prompt "return an empty string if there is no speech".
- **What happened:** For a fully silent 2 second WAV the model returned "The quick brown fox jumps over the lazy dog." instead of an empty string.
- **Severity:** High for a voice product (a made-up "yes" could confirm a forget request).
- **Workaround:** A local energy check rejects near-silent audio before any model call.
- **Suggestion:** A documented "no speech detected" signal for audio input.

## 2026-10-14: Free-tier rate limit of 15 requests a minute surprises a first demo

- **Task:** Run a 12-case eval (24 model calls) and a live demo on one key.
- **What happened:** Calls failed with `RESOURCE_EXHAUSTED` once the minute's allowance was used. The first error text only says to "check your plan and billing details".
- **Severity:** Medium.
- **Workaround:** Pace calls 4.5 s apart, and retry once when the response includes a short `retryDelay`.
- **Suggestion:** Put the per-minute limit and the reset time in the first line of the error.

## 2026-10-14: Compressed browser recording made "pad Thai" sound like "badhai"

- **Task:** Transcribe microphone audio recorded in the browser (compressed by MediaRecorder).
- **What happened:** The same sentence was transcribed correctly from a clean WAV but as "Log badhai for dinner" after the browser round trip, which changed the meaning of the request.
- **Severity:** High for allergy checks.
- **Workaround:** A higher recording bitrate plus a prompt that lists the service's own vocabulary (dish names, allergy terms). Three previously failing phrases were then transcribed correctly in the browser.
- **Suggestion:** First-class "speech context" hints for Gemini audio input, as other speech APIs offer.

## 2026-10-14: Firebase deploy stopped on a housekeeping step and left the site unreleased

- **Task:** First `firebase deploy --only functions,hosting` for a new project.
- **What happened:** The function deployed, then the command ended with an error about a missing container-image cleanup policy before releasing Hosting. The public URL showed "Site Not Found" even though the console said the function was live.
- **Severity:** Medium (confusing: part of the deploy succeeded).
- **Workaround:** Set the cleanup policy (`firebase functions:artifacts:setpolicy`) and run the hosting deploy again.
- **Suggestion:** Treat the cleanup policy as a warning, or release Hosting before it.
