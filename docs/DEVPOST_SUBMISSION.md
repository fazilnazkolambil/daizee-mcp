# Devpost submission: Daizee

Drafted for **Build, Ship, Shape: Amazon Developer Hackathon**. Deadline **Fri Oct 23 2026, 12:00 PT**.

Each section below matches a field or requirement in the [official rules](https://amazonappdev2026.devpost.com/rules) (section 4, "Submission Requirements"). The story is written in my voice and picks up from my Shipaton write-up for DayZer0 (https://devpost.com/software/dayzer0-x2amky).

## Checklist

| Requirement in the rules | Where it's covered | Status |
|---|---|---|
| Primary track | Alexa+: self-hosted MCP server, spec 2025-11-25, Streamable HTTP, with a simulated Alexa+ experience | ✅ |
| Text description of features and functionality | Section 3 | ✅ |
| Public GitHub repo with an open-source license visible in About | https://github.com/fazilnazkolambil/daizee-mcp (MIT; About box set) | ✅ |
| Repo has all source code, assets and setup instructions | README "Quick start" (no accounts or keys). CI passes on a fresh clone of the pushed commit | ✅ |
| Alexa+ tech imported and called at runtime | `McpServer` / `registerTool` in `src/server/`, Streamable HTTP in `src/server/http.ts`, a real MCP client in `tests/contract.test.ts` and the demo page | ✅ |
| Video under 3:00, public on YouTube, shows it working, no unlicensed music | https://youtu.be/9B5eOcgEtjM (2:56; licensed Pixabay music) | ✅ |
| Significant update explained (DayZer0 existed before) | Section 5 and `docs/SIGNIFICANT_UPDATE.md`; the video demos the new work | ✅ |
| Product feedback for each tool: what for, worked well, needs work, onboarding, build again | Section 7 | ✅ |
| Mini challenges | Open Source (section 8). AWS Builder not entered (no AWS service used) | ✅ |
| Open Source: contribution URL, repo URL, GitHub username, what / how / why | Section 8 | ✅ |
| Optional: feature requests with priority | Section 9 | ✅ |
| Optional: friction log, in the rules' format (up to 10% bonus) | Section 10 (9 entries) | ✅ |
| Judges can test it free, without credentials | Section 6: hosted demo with no login, and local quick start | ✅ |
| Everything in English | All of it | ✅ |

Still to do before submitting:
- [x] Deployed: the hosted demo runs the same code as GitHub (checked: today's plan now returns the user's notes).
- [ ] In the YouTube description, change "a sore knee about a week" to "a sore knee 5 days".

---

## 1. Project name

**Daizee**

## 2. Elevator pitch (Devpost allows 200 characters)

> Imagine one health coach inside every assistant you talk to: it remembers your life across conversations, plans your day around it, and knows when to forget. Daizee is that memory, built for Alexa+.

(198 characters)

## 3. About the project

Paste into "About the project" (Markdown):

```markdown
## Inspiration

Three weeks ago I submitted DayZer0 to Shipaton. It's a health coach app I built after a year of figuring out my own health, and then finding out that what worked for me didn't survive contact with my family's week. Its coach is called Daizee. At the end of that write-up I listed what I wanted to do next, and the first thing on the list was "talking to Daizee instead of typing."

This is that. But once I started, I ran into a problem that's bigger than voice.

Voice assistants forget you the moment a conversation ends. Tell one on Monday that you're allergic to peanuts, and on Wednesday it has no idea. For a health coach that isn't a small bug. Remembering you is the whole job.

So I didn't want to build "Daizee, but on Alexa." I wanted Daizee's memory to live somewhere the assistant can't lose it.

## What it does

daizee-mcp is a small server that a voice assistant calls whenever it needs to remember something about you, check something, or log something. I built it for Alexa+, but any assistant that speaks MCP can use it.

You talk the way you'd talk to a person. Say "I'm allergic to peanuts" once. Come back days later in a completely new conversation and say "log pad thai for dinner". The assistant doesn't know about the allergy anymore, but the server does. The meal gets logged, and Daizee tells you pad thai often contains peanuts.

Memories don't stay forever, either. I learned this the hard way building the app: a coach that remembers everything is worse than one that remembers nothing, because it keeps working around a sore knee you got over weeks ago. So every note has a lifespan. A two-week trip lasts two weeks, a sore knee five days, an allergy about a year. Before a note runs out, Daizee asks whether it's still true. And when you ask her to forget something, she always asks "are you sure?" first. The server enforces that step, not a prompt, because a misheard "yes" should never delete an allergy.

It also isn't a separate toy. Connected to DayZer0's real database, a meal I tell the assistant about shows up in the app on my phone a moment later, with the same meal card Daizee posts when you type.

There are seven tools: today's progress, today's plan, logging a meal, remembering something, recalling what she knows, forgetting (with the confirmation), and logging a weigh-in. Every reply is one short sentence written to be heard, not read, and your weight is never said out loud. It shows on screen instead.

## How I built it

The server uses the official MCP TypeScript SDK over Streamable HTTP, on spec 2025-11-25. It's stateless, so it runs comfortably as a single Cloud Function.

I made one decision early that shaped everything else: there's no AI model inside the server. The assistant does the talking and understanding; the server only does memory, rules and logging. That keeps every call fast and predictable (a few milliseconds of server time). It also fits Amazon's guidance for Alexa+ add-ons, which says not to just relay the chat to another AI.

The memory rules are a TypeScript port of what DayZer0's backend already does: priorities, lifespans, duplicates, check-ins before something expires. Allergy checks happen in the server, on every meal, whatever the assistant decides to say.

For the real-app connection, the server writes meals and weigh-ins into the app's Firestore in exactly the shape the app writes them. The app's own backend reacts as if you'd typed. I didn't change a line of the app for this. Before pointing it at real data, I tested it in the Firebase emulator running the app's actual functions, and it can only touch accounts on an allowlist. Each user is identified by their own DayZer0 sign-in token, which is what Alexa+ account linking would send.

Since I don't have Alexa+ add-on access, I built a web page that plays the assistant's part. It's a real MCP client, using the same SDK. You can talk to it, and it answers in a natural voice. Gemini decides which tool to call, and Google's text-to-speech reads the reply. There's a "New conversation" button that wipes the assistant's memory, so you can see the server's survive. A "Behind the scenes" panel shows every MCP message with the server's own timing. It's hosted on Firebase with fictional data, so anyone can try it.

## The honest part

The server, the tools, the memory and safety rules, and the connection to the real app are all real and tested. Alexa+ itself is simulated. Add-on tooling is limited to select partners right now, so nothing here has run on an actual Alexa device, and none of it is certified by Amazon.

In the video, Maya, Kim and Natasha are AI-generated, to show the kind of people I built this for. Every reply Daizee gives them is the product's real answer to that sentence, captured from the demo and played in its real voice.

## Challenges I ran into

Voice turned out to be a safety problem, not just a convenience. When I sent Gemini a recording of pure silence, it transcribed it as "The quick brown fox jumps over the lazy dog." A compressed browser recording turned "pad thai" into "badhai". If you're checking allergies, a misheard dish isn't a typo; it's the wrong answer, and a made-up "yes" could confirm a forget. So silent audio never reaches the model, the transcription is told the words this service actually uses, and anything destructive needs a real, server-checked confirmation.

The other hard part was writing into a live app without being reckless. I built the allowlist, a separate switch you have to turn on deliberately for a real project, and emulator tests against the app's own functions before I let it near real data.

## What I'm proud of

Most of all, that a fresh conversation really does lose nothing. Giving Daizee an actual memory was the part of the app I was proudest of, and now that memory follows you to any assistant.

Also: 331 automated tests pass on a fresh clone, including ones that drive the server with the real MCP client over HTTP, plus 4 more that run against the Firebase emulator. An evaluation of 17 spoken phrases, including a prompt-injection attempt, picks the right tool every time, at about 2.4 seconds per spoken turn. And along the way I found and fixed a bug in the MCP TypeScript SDK itself.

## What I learned

Keep the assistant thin and put the memory and the rules in the service. Then it doesn't matter which assistant you talk to or how often the conversation resets: the safety net is still there.

Voice changes the design too. Every answer needs one sentence you can understand by ear, and some things, like your weight, belong on a screen and not in the room.

## What's next

Running on Alexa+ itself as soon as add-on access opens. Building the sign-in step for full account linking (the server already checks the tokens). Then opening it to DayZer0's users, so the people I built the app for can just talk to Daizee.
```

## 4. Built with

```
typescript, node.js, model-context-protocol, mcp-typescript-sdk, streamable-http, firebase, cloud-firestore, cloud-functions, firebase-hosting, firebase-authentication, google-secret-manager, gemini, google-cloud-text-to-speech, zod, vite, vitest, remotion
```

## 5. Significant update (the project builds on DayZer0)

Paste where the form asks how the project was updated, or at the end of "About the project":

```markdown
## What's new for this hackathon

DayZer0, the Android app, existed before this hackathon. I also entered it in Shipaton 2026 on September 30. This project is not the app. daizee-mcp is a separate, new open-source repository, started on October 14 for this hackathon.

Everything in it is new: the MCP server and its seven tools, the TypeScript port of the app's memory rules, the allergy and diet checks, the connection to the live app's data, per-user token sign-in, the web page that stands in for Alexa+, and the tests and recorded MCP trace.

Before: Daizee lived inside one Android app, and you had to type to her. Now her memory is a service any MCP assistant can call. It survives a fresh conversation, and what you say lands in the app. I didn't change the app's code for this.

The commit-by-commit account is in docs/SIGNIFICANT_UPDATE.md, and the video shows all of the new work running.
```

## 6. Links and testing instructions

- **Video:** https://youtu.be/9B5eOcgEtjM
- **Code repository:** https://github.com/fazilnazkolambil/daizee-mcp
- **Try it out:**
  - https://daizee-mcp-demo.web.app
  - https://play.google.com/store/apps/details?id=com.mobil80.dayZer0

Testing instructions:

```
No login or keys needed.

1. Open https://daizee-mcp-demo.web.app (fictional data; "Reset demo" puts it back any time).
   Say or type "I'm allergic to peanuts". Press "New conversation". Then say "Log pad thai for dinner":
   the peanut warning still comes, though the assistant itself has forgotten. Try "My knee is better now",
   then "Yes", to see forgetting that asks first. Open "Behind the scenes" to see every MCP message.

2. The MCP endpoint is https://daizee-mcp-demo.web.app/mcp. To list the tools:
   npx @modelcontextprotocol/inspector@2.10.1 --cli --transport http --server-url https://daizee-mcp-demo.web.app/mcp --method tools/list

3. To run it yourself:
   git clone https://github.com/fazilnazkolambil/daizee-mcp
   cd daizee-mcp && npm ci && npm test && npm run demo
   It opens on http://localhost:8787 in replay mode, with no accounts or keys.

The hosted demo is shared by everyone who opens it and resets when its server restarts.
```

## 7. Product feedback

Paste into the product feedback field. The form asks, for each tool: which ones and for what, what worked well, what needs work, onboarding, and whether I'd build with it again.

```markdown
### Model Context Protocol (spec 2025-11-25) and the official TypeScript SDK 1.32.1

What I used it for: the whole server (`McpServer`, `registerTool` with zod schemas, stateless Streamable HTTP). I also used the SDK's own client in the demo page and in my contract tests, and the MCP Inspector CLI for quick checks.

What worked well: registering a tool with a zod schema is short and type-safe, and stateless Streamable HTTP is easy to host on a serverless function. Being able to use the official client in a browser meant my demo page is a real MCP client, not a mock. Protocol version negotiation just worked.

What needs work: `McpServer` advertises `tools.listChanged: true` as soon as you register a tool, and overwrites it if you declared `false`. That matters for Alexa+, which captures tools at deploy time, so I fixed it in the SDK (see the Open Source section). Also, after connecting, the client always asks for an optional stream with `GET /mcp`. A stateless server correctly says 405, but the browser console shows that as a red error, which made me think I'd broken something. Most examples are stdio or stateful; a stateless, serverless example would save people time.

Onboarding: the spec and the SDK README were enough. I had a tool answering over Streamable HTTP on the first day.

Would I build with it again? Yes. One server reaches any MCP assistant, and the protocol keeps a clean line between the assistant, which talks, and my service, which remembers.

### Amazon's Alexa+ developer documentation (MCP add-ons and voice design guidance)

What I used it for: shaping the tools for Alexa+. That meant spoken replies of one short sentence, no "chat with me" tool, a fixed tool list, and supporting both protocol versions the docs show (2025-11-25 and 2025-03-26). It also gave me the account-linking shape: a bearer token, plus RFC 9728 metadata.

What worked well: the policy and voice guidance are clear and practical. "Don't just relay the chat to another AI" pushed me to a better design than the one I started with.

What needs work: without partner access, there's no way to test an MCP add-on against Alexa+ at all: no simulator, sandbox or test-device flow. I had to build my own stand-in client. Guidance on account linking for apps whose sign-in is Firebase Auth, with no OAuth server of their own, would help a lot of app developers like me.

Onboarding: the docs were easy to read, but I couldn't get to a real "hello world" on Alexa+ without access.

Would I build with it again? Yes. I'd ship this to DayZer0's users the day add-on access opens.

### Firebase: Hosting, Cloud Functions, Firestore, Authentication (firebase-admin) and the Emulator Suite

What I used it for: hosting the demo and the MCP endpoint (one function), reading and writing the live DayZer0 app's data, checking users' sign-in tokens, and testing against the app's own backend functions in the emulator.

What worked well: the emulator ran the app's real Firestore triggers, so I could prove a voice-logged meal updates the app before touching real data. `verifyIdToken` made per-user sign-in a few lines of code.

What needs work: my first deploy put the function live, then failed on a container-image cleanup policy before releasing Hosting, so the site said "Site Not Found" while the console said everything was fine. The emulators also need Java 21 or newer, which caught me out on my machine.

Onboarding: easy for me, since DayZer0 already runs on Firebase.

Would I build with it again? Yes.

### Google Gemini API (gemini-3.1-flash-lite)

What I used it for: the demo page's assistant brain, which decides which MCP tool to call, and speech-to-text as a fallback.

What worked well: function calling picked the right tool for all 17 phrases in my evaluation, including a prompt-injection attempt.

What needs work:
- `gemini-2.5-flash` returns a 404 for new keys while it's still listed as available.
- Pure silence came back as an invented sentence.
- The rate-limit error doesn't say what the per-minute limit is.
- The same request can take anywhere from about 1 second to over 10.

Onboarding: quick, apart from losing half an hour to that 404.

Would I build with it again? Yes, as a thin brain that never holds the user's memory.

### Google Cloud Text-to-Speech and Secret Manager

What I used them for: Daizee's spoken voice (Chirp 3 HD, Indian English), and keeping the Gemini key out of every file.

What worked well: the voice sounds natural and comes back fast. The server signs in with its own Google identity, so there are no key files to leak.

What needs work: nothing that blocked me.

Would I build with them again? Yes.

### AWS

I didn't use AWS. I had no AWS account during the hackathon, so I'm not entering the AWS Builder mini challenge.
```

## 8. Open Source mini challenge

- **Contribution URL:** https://github.com/fazilnazkolambil/typescript-sdk/tree/fix/mcpserver-list-changed-option
- **Project repository URL:** https://github.com/modelcontextprotocol/typescript-sdk
- **GitHub username:** fazilnazkolambil

```markdown
**What I did:** I fixed a bug in the official MCP TypeScript SDK that I hit while building daizee-mcp. It fixes modelcontextprotocol/typescript-sdk#2622 and #1819.

**How it works:**
- `McpServer` used to switch on `listChanged: true` for tools, resources and prompts as soon as the first one was registered, even if you had declared `false`. So a server with a fixed list advertised a notification it never meant to send, and it still sent `list_changed` notifications when something changed after connecting.
- With the fix, what you declare is what gets advertised; it still defaults to `true` when you don't say. While it's `false`, the `send*ListChanged` helpers do nothing.
- I added tests for tools, resources and prompts. The SDK's full test suite, type check, lint and build all pass.
- Another open PR (#2625) fixes the tools case. This one also covers resources and prompts, and credits that PR.

**Why it matters:** Alexa+ captures an add-on's tools when it's deployed, so a server needs to be able to say "my list is fixed" and mean it. Before this fix, the only way was to reach into the SDK's private state with a cast, which is exactly what I had to do in daizee-mcp.
```

## 9. Feature requests (optional)

| Request | Why it matters for this project | Priority |
|---|---|---|
| A way for non-partner developers to test an MCP add-on against Alexa+ (a simulator, sandbox or test-device flow) | I couldn't run Daizee on Alexa+ at all, so the demo had to use a stand-in client | **Critical** |
| A guide or reference implementation for Alexa+ account linking when the app's sign-in is Firebase Auth | The token check is built. The missing piece is an OAuth sign-in server, which Firebase doesn't provide | **Important** |
| Alexa+ guidance for safety-critical moments: confirming before deleting, allergy warnings, keeping numbers like weight off the speaker | Health add-ons need a pattern that's consistent and tested | **Important** |
| A public `listChanged` option in the MCP TypeScript SDK (my fix in section 8) | Tools are captured at deploy time, so a server should be able to declare a fixed list | **Nice-to-have** |

## 10. Friction log entries (optional, up to 10% bonus)

Each entry follows the rules' format: task, steps, expected vs actual, severity, workaround, suggestion. They come from `docs/FRICTION_LOG.md`, written down as each one happened.

```markdown
**1. The MCP TypeScript SDK advertises `tools.listChanged` by default (2026-10-14)**
- Task: build a server whose tool list never changes (Alexa+ captures tools at deploy time).
- Steps: created `McpServer` (@modelcontextprotocol/sdk 1.x), registered seven tools with `registerTool`, served it over Streamable HTTP, and read the `initialize` response in the wire trace.
- Expected: the declared tool capability, without `listChanged: true`.
- Actual: `initialize` advertised `capabilities.tools.listChanged: true`, though the server never sends that notification.
- Severity: Low.
- Workaround: after registering, set the flag back to false on the server's internal capabilities object (a cast).
- Suggestion: honor a declared `listChanged: false`. I wrote that fix (see the Open Source section).

**2. A new TypeScript major didn't match the surrounding tools (2026-10-14)**
- Task: pick toolchain versions for a new project.
- Steps: ran `npm view typescript version` to choose the latest.
- Expected: a version the test and run tooling supports.
- Actual: a brand-new 7.x major, while the tooling targets 5.x.
- Severity: Low.
- Workaround: pinned `typescript@~5.9.3`.
- Suggestion: MCP quick-starts that say "install the latest TypeScript" should name a tested version.

**3. `npm install` warns about unreviewed install scripts (2026-10-14)**
- Task: install dependencies on a fresh Node 26 machine.
- Steps: `npm install` in the new project.
- Expected: a clean install.
- Actual: a warning that `esbuild`'s postinstall script isn't covered by `allowScripts`. Everything still worked.
- Severity: Low (noise that can worry someone new).
- Workaround: none needed.
- Suggestion: document which install scripts MCP-related tooling needs.

**4. A stateless server shows a red "405" in the browser on every connection (2026-10-14)**
- Task: connect a browser MCP client to a stateless Streamable HTTP server.
- Steps: used the SDK's `Client` and `StreamableHTTPClientTransport` in the demo page, against the stateless server.
- Expected: no errors from a correct setup.
- Actual: after `initialized`, the client always sends `GET /mcp` for an optional stream. The server correctly answers 405, and the console prints a red "Failed to load resource" every time.
- Severity: Low (cosmetic, but alarming).
- Workaround: labelled that row "no stream offered: stateless server" in the trace, and documented it.
- Suggestion: a client option to skip the GET for stateless servers, or a response header that says so.

**5. `gemini-2.5-flash` returns 404 for a new API key (2026-10-14)**
- Task: call Gemini from the demo's backend.
- Steps: made a new API key, called `generateContent` with `gemini-2.5-flash`, and ran the 12-case evaluation.
- Expected: answers.
- Actual: every call returned 404, "no longer available to new users", while the model was still in the key's own model list. All 12 cases failed with an unclear message, and I lost about 30 minutes.
- Severity: Medium.
- Workaround: listed the models that work for the key, and switched to `gemini-3.1-flash-lite`.
- Suggestion: hide retired models from `ListModels` for new keys, or return a clearer error than 404.

**6. Gemini invents a sentence for pure silence (2026-10-14)**
- Task: transcribe microphone audio, returning nothing when nobody speaks.
- Steps: sent a fully silent 2-second WAV with the prompt "return an empty string if there is no speech".
- Expected: an empty string.
- Actual: "The quick brown fox jumps over the lazy dog."
- Severity: High for a voice product (an invented "yes" could confirm a forget request).
- Workaround: a local energy check rejects near-silent audio before any model call.
- Suggestion: a documented "no speech detected" signal for audio input.

**7. The free-tier rate limit surprises a first demo (2026-10-14)**
- Task: run a 12-case evaluation (24 model calls) and a live demo on one key.
- Steps: ran the evaluation, then the demo, on the same free key.
- Expected: either success or an error that names the limit.
- Actual: `RESOURCE_EXHAUSTED`, and the first line only said to "check your plan and billing details". The limit is 15 requests a minute.
- Severity: Medium.
- Workaround: spaced calls 4.5 seconds apart, and retried once when the response included a short `retryDelay`.
- Suggestion: put the per-minute limit and the reset time in the first line of the error.

**8. A compressed browser recording turned "pad thai" into "badhai" (2026-10-14)**
- Task: transcribe microphone audio recorded in the browser.
- Steps: recorded "Log pad thai for dinner" with MediaRecorder (compressed), sent it to Gemini, and compared it with the same sentence from a clean WAV.
- Expected: "Log pad thai for dinner", as from the clean WAV.
- Actual: "Log badhai for dinner". That changes the meaning, and the allergy check depends on the dish.
- Severity: High for allergy checks.
- Workaround: a higher recording bitrate, plus a prompt listing the service's own words (dish names, allergy terms). Three phrases that had failed then came through correctly.
- Suggestion: first-class "speech context" hints for Gemini audio input.

**9. Firebase deploy stopped on a housekeeping step and left the site unreleased (2026-10-14)**
- Task: first deploy of a new project.
- Steps: `firebase deploy --only functions,hosting`.
- Expected: the function and Hosting both live.
- Actual: the function deployed, then the command failed on a missing container-image cleanup policy before releasing Hosting. The URL showed "Site Not Found" while the console said the function was live.
- Severity: Medium (confusing, because half of it worked).
- Workaround: ran `firebase functions:artifacts:setpolicy`, then deployed Hosting again.
- Suggestion: treat the cleanup policy as a warning, or release Hosting before it.
```

## 11. Image gallery (optional, recommended)

Devpost shows these on the project page; 3:2 images work best. Ready to use:
- `reel-studio/out/daizee-demo/thumbnail.png`: the YouTube thumbnail.

Worth adding, as stills from the recordings:
- the demo page with the peanut warning and "Behind the scenes" open;
- the `log_meal` request and response JSON;
- DayZer0 on the phone, showing the pad thai card and "What Daizee remembers".

## Notes from the pre-submission check (Oct 23)

- **Safe to go public:**
  - No keys, tokens, private keys or service-account files in any commit; `.env` was never tracked.
  - The real DayZer0 account IDs appear nowhere in the history.
  - Two things are public but not secret: the `dayzer0-prod` project name (already public as dayzer0-prod.web.app), and your Gmail address in the `deploy` script, which has been in the public history since the first deploy commit.
  - `npm audit` reports 8 moderate advisories, all from one `uuid` issue deep inside Google's Firestore libraries. It affects a code path this project doesn't use, and the only fix is a breaking downgrade.
  - The public demo's Gemini and text-to-speech calls have daily caps, so it can't run up a bill.
- **Working:**
  - CI passes on a fresh clone of the pushed commit: `npm ci`, both type checks and the tests.
  - On a fresh clone: 331 tests pass (4 more need the Firebase emulator). An earlier count of 1,442 was wrong: it included copies of the tests in local `.claude/worktrees/` folders. 21 of 21 spoken replies pass the voice lint, and the server, demo page and Cloud Function all build.
  - The hosted MCP endpoint lists all seven tools. The allergy, then a separate request, then pad thai, returns the peanut warning word for word as in the video.
  - The demo was reset afterwards.
