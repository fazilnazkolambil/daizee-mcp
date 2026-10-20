import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { ManualClock } from "../src/memory/index.js";
import { firebaseIssuer, type VerifyIdToken } from "../src/server/auth.js";
import { buildApp } from "../src/server/main.js";
import { authConfig, FirestoreStore, parseAllowedUids, type FirestoreSettings } from "../src/store/index.js";
import { FakeDocDb } from "./fakeDocDb.js";

/**
 * Per-user auth on /mcp with Firebase ID tokens. verifyIdToken is mocked:
 * tokens below are made-up strings, never real credentials, and all uids are invented.
 */

const PROJECT = "demo-dayzer0";
const DEMO_UID = "uid-demo-111";
const SECOND_UID = "uid-second-222";
const STRANGER_UID = "uid-not-allowed-333";

const TOKENS: Record<string, string> = {
  "good-demo-token": DEMO_UID,
  "good-second-token": SECOND_UID,
  "good-stranger-token": STRANGER_UID,
};

/** Stands in for firebase-admin's verifyIdToken, with its error codes. */
const fakeVerify: VerifyIdToken = async (token) => {
  if (token === "expired-token") throw Object.assign(new Error("expired"), { code: "auth/id-token-expired" });
  const uid = TOKENS[token];
  if (!uid) throw Object.assign(new Error("bad signature"), { code: "auth/argument-error" });
  return { uid };
};

const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "auth-test", version: "1" } },
};

let http: Server | undefined;

afterEach(async () => {
  await new Promise<void>((ok) => (http ? http.close(() => ok()) : ok()));
  http = undefined;
});

async function start(env: NodeJS.ProcessEnv = {}) {
  const db = new FakeDocDb();
  for (const [uid, name] of [[DEMO_UID, "Demo"], [SECOND_UID, "Second"], [STRANGER_UID, "Stranger"]]) {
    db.docs.set(`users/${uid}`, { name, timezone: "Asia/Kolkata", targetCalories: 2000, proteinGoal: 120, carbsGoal: 220, fatGoal: 60 });
  }
  const users = parseAllowedUids(`demo=${DEMO_UID},second=${SECOND_UID}`);
  const settings: FirestoreSettings = { projectId: PROJECT, users, emulator: true };
  const clock = new ManualClock();
  const store = new FirestoreStore(db, users, clock);
  const { handler } = buildApp({
    live: { store, clock, defaultUser: "demo" },
    auth: authConfig(settings, fakeVerify, env),
  });
  http = createServer((req, res) => void handler(req, res));
  await new Promise<void>((ok) => http!.listen(0, "127.0.0.1", ok));
  return { db, base: `http://127.0.0.1:${(http.address() as AddressInfo).port}` };
}

async function connect(base: string, headers: Record<string, string>) {
  const client = new Client({ name: "auth-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }));
  return client;
}

async function logMealAs(base: string, headers: Record<string, string>) {
  const client = await connect(base, headers);
  const result = await client.callTool({
    name: "log_meal",
    arguments: { mealType: "breakfast", items: [{ name: "idli", quantity: 2, calories: 240, protein: 8, carbs: 48, fat: 1 }] },
  });
  await client.close();
  expect(result.isError).toBeFalsy();
}

const mealsOf = (db: FakeDocDb, uid: string) => [...db.docs.keys()].filter((p) => p.startsWith(`users/${uid}/meals/`));

describe("Firebase ID token auth on /mcp", () => {
  it("a valid token acts as that token's uid", async () => {
    const { db, base } = await start();
    await logMealAs(base, { authorization: "Bearer good-second-token" });
    expect(mealsOf(db, SECOND_UID)).toHaveLength(1);
    expect(mealsOf(db, DEMO_UID)).toHaveLength(0);
  });

  it("ignores x-daizee-user when a token is sent, even with DEMO_MODE=1", async () => {
    for (const env of [{}, { DEMO_MODE: "1" }]) {
      const { db, base } = await start(env);
      await logMealAs(base, { authorization: "Bearer good-demo-token", "x-daizee-user": "second" });
      expect(mealsOf(db, DEMO_UID)).toHaveLength(1);
      expect(mealsOf(db, SECOND_UID)).toHaveLength(0);
      await new Promise<void>((ok) => http!.close(() => ok()));
      http = undefined;
    }
  });

  it("a missing token gets 401 with a WWW-Authenticate pointing at the metadata, and the header alone is not enough", async () => {
    const { db, base } = await start();
    for (const headers of [HEADERS, { ...HEADERS, "x-daizee-user": "demo" }]) {
      const res = await fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify(INIT) });
      expect(res.status).toBe(401);
      const challenge = res.headers.get("www-authenticate") ?? "";
      expect(challenge).toMatch(/^Bearer /);
      expect(challenge).toContain(`resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`);
      expect(challenge).not.toContain("error=");
      expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/sign in/i);
    }
    expect(db.touched).toHaveLength(0);
  });

  it.each([
    ["an expired token", "Bearer expired-token", /expired/],
    ["an invalid token", "Bearer forged-token", /not valid/],
    ["a non-Bearer scheme", "Basic dXNlcjpwYXNz", /Bearer/],
    ["an empty Bearer", "Bearer ", /Bearer/],
  ])("%s gets 401 invalid_token", async (_label, authorization, description) => {
    const { db, base } = await start();
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: { ...HEADERS, authorization }, body: JSON.stringify(INIT) });
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toMatch(/^Bearer error="invalid_token", error_description="[^"]+", resource_metadata="/);
    expect(challenge).toMatch(description);
    expect(db.touched).toHaveLength(0);
  });

  it("a valid token for an account outside the allowlist gets 403 and reads nothing", async () => {
    const { db, base } = await start();
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...HEADERS, authorization: "Bearer good-stranger-token" },
      body: JSON.stringify(INIT),
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("www-authenticate")).toMatch(/error="access_denied"/);
    expect(db.touched).toHaveLength(0);
  });

  it("DEMO_MODE=1 lets the demo header through when no token is sent, still only for allowlisted names", async () => {
    const { db, base } = await start({ DEMO_MODE: "1" });
    await logMealAs(base, { "x-daizee-user": "second" });
    expect(mealsOf(db, SECOND_UID)).toHaveLength(1);

    const client = await connect(base, { "x-daizee-user": "stranger" });
    const result = await client.callTool({ name: "get_day_progress", arguments: {} });
    await client.close();
    expect(result.isError).toBe(true);
    expect(mealsOf(db, STRANGER_UID)).toHaveLength(0);
  });

  it("DEMO_MODE must be exactly 1", async () => {
    const { base } = await start({ DEMO_MODE: "true" });
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: { ...HEADERS, "x-daizee-user": "demo" }, body: JSON.stringify(INIT) });
    expect(res.status).toBe(401);
  });
});

describe("OAuth protected resource metadata (RFC 9728)", () => {
  it.each(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"])(
    "%s names the DayZer0 project's Firebase token issuer",
    async (path) => {
      const { base } = await start();
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      const doc = (await res.json()) as Record<string, unknown>;
      expect(doc).toMatchObject({
        resource: `${base}/mcp`,
        authorization_servers: [firebaseIssuer(PROJECT)],
        bearer_methods_supported: ["header"],
      });
      expect(doc.authorization_servers).toEqual(["https://securetoken.google.com/demo-dayzer0"]);
      expect(typeof doc.resource_name).toBe("string");
    },
  );

  it("uses DAIZEE_PUBLIC_URL, or the proxy's forwarded host, for the resource", async () => {
    const { base } = await start({ DAIZEE_PUBLIC_URL: "https://voice.example.test/" });
    const doc = (await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json()) as { resource: string };
    expect(doc.resource).toBe("https://voice.example.test/mcp");
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: HEADERS, body: JSON.stringify(INIT) });
    expect(res.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://voice.example.test/.well-known/oauth-protected-resource/mcp"',
    );
    await new Promise<void>((ok) => http!.close(() => ok()));
    http = undefined;

    const second = await start();
    const proxied = await fetch(`${second.base}/.well-known/oauth-protected-resource`, {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "proxy.example.test" },
    });
    expect(((await proxied.json()) as { resource: string }).resource).toBe("https://proxy.example.test/mcp");
  });

  it("the in-memory demo (no auth) says plainly that it has none, and the header still works", async () => {
    const { handler } = buildApp({ demo: true });
    http = createServer((req, res) => void handler(req, res));
    await new Promise<void>((ok) => http!.listen(0, "127.0.0.1", ok));
    const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    const doc = (await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json()) as Record<string, unknown>;
    expect(doc.authorization_servers).toBeUndefined();
    expect(doc.bearer_methods_supported).toEqual([]);
    const client = await connect(base, { "x-daizee-user": "maya" });
    const result = await client.callTool({ name: "get_day_progress", arguments: {} });
    await client.close();
    expect(result.isError).toBeFalsy();
  });
});
