import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/server/main.js";
import { MAX_SPOKEN_WORDS } from "../src/server/spoken.js";

/**
 * Contract tests: the REAL MCP SDK client against the REAL HTTP server.
 * This is also the evidence that the required technology runs at runtime:
 * initialize -> tools/list -> tools/call, over Streamable HTTP.
 */

let http: Server;
let base: string;
const trace: Array<Record<string, unknown>> = [];

const HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

beforeAll(async () => {
  const { handler } = buildApp({ demo: true });
  http = createServer((req, res) => void handler(req, res));
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((ok) => http.close(() => ok()));
  // Evidence for reviewers: a real trace written by CI, not hand-typed.
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../docs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "WIRE_TRACE_SAMPLE.jsonl"),
    trace.map((t) => JSON.stringify(t)).join("\n") + "\n",
  );
});

/** A fetch that records each MCP message, like the demo page's wire panel. */
const tracedFetch: typeof fetch = async (input, init) => {
  const started = performance.now();
  const res = await fetch(input, init);
  let rpc: { method?: string; id?: unknown; params?: { name?: string } } = {};
  try {
    rpc = JSON.parse(String(init?.body ?? "{}"));
  } catch {
    /* not JSON */
  }
  trace.push({
    method: rpc.method ?? "(none)",
    tool: rpc.params?.name,
    httpStatus: res.status,
    roundTripMs: Math.round((performance.now() - started) * 10) / 10,
    serverTiming: res.headers.get("server-timing"),
  });
  return res;
};

async function connect(user = "maya") {
  const client = new Client({ name: "contract-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    fetch: tracedFetch,
    requestInit: { headers: { "x-daizee-user": user } },
  });
  await client.connect(transport);
  return client;
}

async function rawInitialize(protocolVersion: string) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion, capabilities: {}, clientInfo: { name: "raw", version: "1" } },
    }),
  });
  return { res, json: (await res.json()) as { result?: { protocolVersion: string; serverInfo: { name: string } } } };
}

describe("protocol negotiation", () => {
  it.each(["2025-03-26", "2025-11-25"])("answers initialize for protocol %s", async (version) => {
    const { res, json } = await rawInitialize(version);
    expect(res.status).toBe(200);
    expect(json.result?.protocolVersion).toBe(version);
    expect(json.result?.serverInfo.name).toBe("daizee-mcp");
  });

  it("falls back to a version it supports when asked for an unknown one", async () => {
    const { res, json } = await rawInitialize("2099-01-01");
    expect(res.status).toBe(200);
    expect(["2025-11-25", "2025-06-18", "2025-03-26"]).toContain(json.result?.protocolVersion);
  });
});

describe("transport rules", () => {
  it("declares only what it honors: the tool list is fixed (no listChanged)", async () => {
    const client = await connect();
    expect(client.getServerCapabilities()?.tools?.listChanged).toBeFalsy();
    await client.close();
  });

  it("is stateless: no session id is issued", async () => {
    const { res } = await rawInitialize("2025-11-25");
    expect(res.headers.get("mcp-session-id")).toBeNull();
  });

  it("answers GET and DELETE on /mcp with 405", async () => {
    for (const method of ["GET", "DELETE"]) {
      const res = await fetch(`${base}/mcp`, { method, headers: { accept: "text/event-stream" } });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
  });

  it("rejects a foreign browser Origin with 403", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...HEADERS, origin: "https://evil.example" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  it("allows a localhost Origin and exposes Server-Timing to the browser", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("access-control-expose-headers")).toMatch(/Server-Timing/);
  });

  it("rejects malformed JSON without crashing", async () => {
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: HEADERS, body: "{not json" });
    expect(res.status).toBe(400);
  });

  it("serves the OAuth protected-resource stub honestly", async () => {
    const res = await fetch(`${base}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { note: string }).note).toMatch(/no authentication/i);
  });
});

describe("tools over real MCP", () => {
  it("lists exactly the six tools, each with a description, schema and annotations", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_day_progress",
      "log_meal",
      "log_weight",
      "recall_what_you_know",
      "remember_about_user",
      "resolve_memory",
    ]);
    for (const tool of tools) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(40);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations?.destructiveHint).toBeDefined();
      expect(tool.annotations?.readOnlyHint).toBeDefined();
    }
    // No free-form chat relay tool: that is rejected by Alexa+ policy.
    expect(tools.some((t) => /chat|ask|converse/i.test(t.name))).toBe(false);
    await client.close();
  });

  it("marks only resolve_memory as destructive", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name)).toEqual(["resolve_memory"]);
    await client.close();
  });

  it("calls get_day_progress and returns data matching its output schema", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "get_day_progress", arguments: {} });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as { checkIns: unknown[]; spoken: string };
    expect(out.checkIns).toHaveLength(1);
    expect(out.spoken.length).toBeGreaterThan(0);
    await client.close();
  });

  it("runs the headline story end to end over MCP: allergy survives a brand-new connection", async () => {
    const teacher = await connect("sam");
    await teacher.callTool({ name: "remember_about_user", arguments: { category: "allergy", text: "allergic to peanuts" } });
    await teacher.close(); // the 'assistant' forgets everything here

    const fresh = await connect("sam"); // a new conversation, a new initialize
    const meal = await fresh.callTool({
      name: "log_meal",
      arguments: { mealType: "dinner", items: [{ name: "pad thai" }] },
    });
    const out = meal.structuredContent as { safetyFlags: Array<{ memoryText: string }> };
    expect(out.safetyFlags[0]?.memoryText).toBe("allergic to peanuts");
    await fresh.close();
  });

  it("is idempotent for retried writes", async () => {
    const client = await connect("sam");
    const args = { mealType: "lunch", items: [{ name: "dal" }, { name: "rice" }] };
    const a = (await client.callTool({ name: "log_meal", arguments: args })).structuredContent as { mealId: string; duplicate: boolean };
    const b = (await client.callTool({ name: "log_meal", arguments: args })).structuredContent as { mealId: string; duplicate: boolean };
    expect(b.mealId).toBe(a.mealId);
    expect(b.duplicate).toBe(true);
    await client.close();
  });

  it("returns a tool error (not a crash) for an unknown demo user", async () => {
    const client = await connect("ghost");
    const result = await client.callTool({ name: "get_day_progress", arguments: {} });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("rejects invalid arguments", async () => {
    const client = await connect();
    const result = await client
      .callTool({ name: "log_weight", arguments: { kg: 5 } })
      .catch((e: unknown) => ({ isError: true, thrown: String(e) }));
    expect((result as { isError?: boolean }).isError).toBe(true);
    await client.close();
  });

  it("keeps every spoken reply short, plain and free of formatting", async () => {
    const client = await connect();
    const calls = [
      { name: "get_day_progress", arguments: {} },
      { name: "recall_what_you_know", arguments: {} },
      { name: "log_meal", arguments: { mealType: "dinner", items: [{ name: "pad thai" }, { name: "chai" }] } },
      { name: "remember_about_user", arguments: { category: "habit", text: "walks after dinner" } },
      { name: "resolve_memory", arguments: { query: "knee" } },
      { name: "log_weight", arguments: { kg: 61.5 } },
    ];
    for (const call of calls) {
      const result = await client.callTool(call);
      const spoken = (result.structuredContent as { spoken: string }).spoken;
      expect(spoken.split(/\s+/).length).toBeLessThanOrEqual(MAX_SPOKEN_WORDS);
      expect(spoken).not.toMatch(/[*_`#|>~]/);
    }
    await client.close();
  });

  it("answers fast: p50 server-side latency well under 500 ms", async () => {
    const client = await connect();
    const times: number[] = [];
    for (let i = 0; i < 15; i++) {
      const t = performance.now();
      await client.callTool({ name: "recall_what_you_know", arguments: {} });
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length / 2)] ?? 0).toBeLessThan(500);
    await client.close();
  });
});

describe("demo controls", () => {
  it("advances the clock and makes the knee note expire, over the real wire", async () => {
    const client = await connect("maya");
    const before = (await client.callTool({ name: "recall_what_you_know", arguments: {} })).structuredContent as {
      memories: Array<{ text: string }>;
    };
    expect(before.memories.map((m) => m.text)).toContain("left knee is sore");

    const adv = await fetch(`${base}/demo/advance-clock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ days: 6 }),
    });
    expect(adv.status).toBe(200);

    const after = (await client.callTool({ name: "recall_what_you_know", arguments: {} })).structuredContent as {
      memories: Array<{ text: string }>;
    };
    expect(after.memories.map((m) => m.text)).not.toContain("left knee is sore");
    expect(after.memories.map((m) => m.text)).toContain("allergic to peanuts");

    await fetch(`${base}/demo/reset`, { method: "POST" });
    await client.close();
  });

  it("refuses silly clock values", async () => {
    const res = await fetch(`${base}/demo/advance-clock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ days: 9999 }),
    });
    expect(res.status).toBe(400);
  });
});
