# Friction log

Only things that actually happened while building. Each entry: the task attempted, the steps taken, expected vs actual result, severity, the workaround used, and a suggestion. Nothing here is copied from documentation.

## 2026-10-14: MCP TypeScript SDK advertises `tools.listChanged` by default

- **Task:** Build a server whose tool list never changes (Alexa+ captures tools at deploy time).
- **Steps:** Created `McpServer` (@modelcontextprotocol/sdk 1.x), registered seven tools with `registerTool`, served it over Streamable HTTP, and read the `initialize` response in the wire trace.
- **Expected:** The declared tool capability, without `listChanged: true`.
- **Actual:** `initialize` advertised `capabilities.tools.listChanged: true`, though the server never sends that notification.
- **Severity:** Low (a small dishonesty in what the server declares).
- **Workaround:** After registering tools, set the flag back to false on the server's internal capabilities object (a cast, because there is no public option).
- **Suggestion:** Honor a declared `listChanged: false`. I wrote that fix: https://github.com/fazilnazkolambil/typescript-sdk/tree/fix/mcpserver-list-changed-option

## 2026-10-14: A brand-new major TypeScript release did not match the surrounding tools

- **Task:** Pick toolchain versions for a new project.
- **Steps:** Ran `npm view typescript version` to choose the latest.
- **Expected:** A version the test and run tooling supports.
- **Actual:** A brand-new 7.x major, while the tooling targets 5.x.
- **Severity:** Low.
- **Workaround:** Pinned `typescript@~5.9.3`.
- **Suggestion:** MCP quick-starts that say "install the latest TypeScript" should name a tested version.

## 2026-10-14: `npm install` warns about unreviewed install scripts

- **Task:** Install dependencies on a fresh Node 26 machine.
- **Steps:** Ran `npm install` in the new project.
- **Expected:** A clean install.
- **Actual:** A warning that `esbuild`'s postinstall script isn't covered by `allowScripts`. Everything still worked.
- **Severity:** Low (noise that could worry a new user).
- **Workaround:** None needed.
- **Suggestion:** Document which install scripts MCP-related tooling needs.

## 2026-10-14: A stateless server makes the browser console show a "405" on every connection

- **Task:** Connect a browser MCP client to a stateless Streamable HTTP server.
- **Steps:** Used the SDK's `Client` and `StreamableHTTPClientTransport` in the demo page, against the stateless server.
- **Expected:** No errors from a correct setup.
- **Actual:** After `initialized`, the client always sends `GET /mcp` for an optional stream. The server correctly answers 405, and the console prints a red "Failed to load resource" every time.
- **Severity:** Low (cosmetic, but alarming).
- **Workaround:** Labelled that row "no stream offered: stateless server" in the trace, and documented it.
- **Suggestion:** A client option to skip the optional GET for stateless servers, or a response header that says so.

## 2026-10-14: `gemini-2.5-flash` returns 404 for a brand-new API key

- **Task:** Call Gemini from the demo's backend.
- **Steps:** Made a new API key, called `generateContent` with `gemini-2.5-flash`, and ran the 12-case evaluation.
- **Expected:** Answers.
- **Actual:** Every call returned 404, "no longer available to new users", while the model was still in the key's own model list. All 12 cases failed with an unclear message.
- **Severity:** Medium (about 30 minutes lost).
- **Workaround:** Listed the models that work for the key, and switched to `gemini-3.1-flash-lite`.
- **Suggestion:** Hide retired models from `ListModels` for new keys, or return a clearer error than 404.

## 2026-10-14: Gemini invents a sentence for pure silence

- **Task:** Transcribe microphone audio, returning nothing when nobody speaks.
- **Steps:** Sent a fully silent 2-second WAV with the prompt "return an empty string if there is no speech".
- **Expected:** An empty string.
- **Actual:** "The quick brown fox jumps over the lazy dog."
- **Severity:** High for a voice product (a made-up "yes" could confirm a forget request).
- **Workaround:** A local energy check rejects near-silent audio before any model call.
- **Suggestion:** A documented "no speech detected" signal for audio input.

## 2026-10-14: Free-tier rate limit of 15 requests a minute surprises a first demo

- **Task:** Run a 12-case evaluation (24 model calls) and a live demo on one key.
- **Steps:** Ran the evaluation, then the demo, on the same free key.
- **Expected:** Either success or an error that names the limit.
- **Actual:** `RESOURCE_EXHAUSTED`, and the first line only said to "check your plan and billing details". The limit is 15 requests a minute.
- **Severity:** Medium.
- **Workaround:** Spaced calls 4.5 seconds apart, and retried once when the response included a short `retryDelay`.
- **Suggestion:** Put the per-minute limit and the reset time in the first line of the error.

## 2026-10-14: Compressed browser recording turned "pad thai" into "badhai"

- **Task:** Transcribe microphone audio recorded in the browser.
- **Steps:** Recorded "Log pad thai for dinner" with MediaRecorder (compressed), sent it to Gemini, and compared it with the same sentence from a clean WAV.
- **Expected:** "Log pad thai for dinner", as from the clean WAV.
- **Actual:** "Log badhai for dinner". That changes the meaning, and the allergy check depends on the dish.
- **Severity:** High for allergy checks.
- **Workaround:** A higher recording bitrate, plus a prompt listing the service's own words (dish names, allergy terms). Three phrases that had failed then came through correctly.
- **Suggestion:** First-class "speech context" hints for Gemini audio input, as other speech APIs offer.

## 2026-10-14: Firebase deploy stopped on a housekeeping step and left the site unreleased

- **Task:** First deploy of a new project.
- **Steps:** Ran `firebase deploy --only functions,hosting`.
- **Expected:** The function and Hosting both live.
- **Actual:** The function deployed, then the command failed on a missing container-image cleanup policy before releasing Hosting. The public URL showed "Site Not Found" while the console said the function was live.
- **Severity:** Medium (confusing: part of the deploy succeeded).
- **Workaround:** Set the cleanup policy (`firebase functions:artifacts:setpolicy`), then ran the Hosting deploy again.
- **Suggestion:** Treat the cleanup policy as a warning, or release Hosting before it.
