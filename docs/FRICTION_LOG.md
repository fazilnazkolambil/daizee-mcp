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
