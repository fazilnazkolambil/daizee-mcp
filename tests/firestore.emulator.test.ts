import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ManualClock } from "../src/memory/index.js";
import { buildApp } from "../src/server/main.js";
import { dayKeyFor, firestoreStoreFromEnv } from "../src/store/index.js";

/**
 * End to end against the Firestore EMULATOR (never a real project):
 * an MCP client calls log_meal over HTTP, and the meal lands in Firestore in
 * the DayZer0 app's shape.
 *
 * With DAYZER0_TRIGGERS=1 the DayZer0 app's own Cloud Functions are running in
 * the Functions emulator too (see scripts/emulator-test.mjs), and the test
 * waits for their onMealWritten trigger to rebuild daily/{date}.meals and post
 * the meal card in the Daizee chat: the same thing the phone app shows.
 *
 * Run: npm run test:emulator   (or with DAYZER0_DIR=... to include the app's triggers)
 */

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = "demo-daizee"; // "demo-" projects can only ever reach emulators
const UID = "emulator-demo-uid"; // invented
const TZ = "Asia/Kolkata";

describe.skipIf(!EMULATOR)("log_meal over MCP into the Firestore emulator", () => {
  let http: Server;
  let base: string;
  let admin: typeof import("firebase-admin/firestore");
  let fs: import("firebase-admin/firestore").Firestore;

  beforeAll(async () => {
    const { initializeApp } = await import("firebase-admin/app");
    admin = await import("firebase-admin/firestore");
    fs = admin.getFirestore(initializeApp({ projectId: PROJECT }, "emulator-test"));
    await fetch(`http://${EMULATOR}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
    await fs.doc(`users/${UID}`).set({
      name: "Emulator Demo",
      timezone: TZ,
      targetCalories: 2000,
      proteinGoal: 120,
      carbsGoal: 220,
      fatGoal: 60,
    });

    const clock = new ManualClock();
    const { store } = await firestoreStoreFromEnv(
      { FIREBASE_PROJECT_ID: PROJECT, FIRESTORE_EMULATOR_HOST: EMULATOR, DAIZEE_ALLOWED_UIDS: `demo=${UID}` },
      clock,
    );
    const { handler } = buildApp({ live: { store, clock, defaultUser: "demo" } });
    http = createServer((req, res) => void handler(req, res));
    await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((ok) => http?.close(() => ok()));
  });

  async function connect(user: string) {
    const client = new Client({ name: "emulator-test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { "x-daizee-user": user } } }),
    );
    return client;
  }

  it("creates the meal document the app's trigger consumes", async () => {
    const client = await connect("demo");
    const result = await client.callTool({
      name: "log_meal",
      arguments: { mealType: "breakfast", items: [{ name: "idli", quantity: 2, calories: 240, protein: 8, carbs: 48, fat: 1 }, { name: "sambar", calories: 130, protein: 6, carbs: 18, fat: 4 }] },
    });
    await client.close();
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as { mealId: string; totalsToday: { calories: number } };
    expect(out.totalsToday.calories).toBe(370);

    const snap = await fs.doc(`users/${UID}/meals/${out.mealId}`).get();
    expect(snap.exists).toBe(true);
    const meal = snap.data() ?? {};
    expect(meal).toMatchObject({ id: out.mealId, mealType: "BREAKFAST", totalCalories: 370, protein: 14, carbs: 66, fat: 5, fiber: 0, source: "alexa", editedByUser: false });
    expect(typeof meal.createdAt).toBe("number");
    expect(meal.foods).toHaveLength(2);

    // The same query the app's mealTotals.js runs to rebuild the day.
    const dayKey = dayKeyFor(Number(meal.createdAt), TZ);
    const start = Date.parse(`${dayKey}T00:00:00+05:30`);
    const sameDay = await fs.collection(`users/${UID}/meals`).where("createdAt", ">=", start).where("createdAt", "<", start + 86_400_000).orderBy("createdAt", "asc").get();
    expect(sameDay.docs.map((d) => d.id)).toContain(out.mealId);
  });

  it.runIf(process.env.DAYZER0_TRIGGERS === "1")("the app's onMealWritten trigger rebuilds today's totals and posts the chat card", async () => {
    const client = await connect("demo");
    const result = await client.callTool({ name: "log_meal", arguments: { mealType: "lunch", items: [{ name: "dal", calories: 180, protein: 10, carbs: 26, fat: 4 }] } });
    await client.close();
    const { mealId } = result.structuredContent as { mealId: string };
    const dayKey = dayKeyFor(Date.now(), TZ);

    // The trigger runs asynchronously in the Functions emulator; wait for it.
    let daily: Record<string, unknown> | undefined;
    for (let i = 0; i < 60; i++) {
      daily = (await fs.doc(`users/${UID}/daily/${dayKey}`).get()).data();
      const meals = daily?.meals as { mealIds?: string[] } | undefined;
      if (meals?.mealIds?.includes(mealId)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(daily?.meals).toMatchObject({ mealCount: 2, calories: 550, protein: 24 });

    let card: Record<string, unknown> | undefined;
    for (let i = 0; i < 20 && !card; i++) {
      card = (await fs.doc(`users/${UID}/chats/${dayKey}/messages/log_${mealId}`).get()).data();
      if (!card) await new Promise((r) => setTimeout(r, 500));
    }
    expect(card).toMatchObject({ kind: "action_card", payload: { action: "log_meal", mealId, mealType: "LUNCH" } });
  }, 60_000);

  it.runIf(process.env.DAYZER0_TRIGGERS === "1")("the app's onWeightLogWritten trigger makes a voice weigh-in the profile weight", async () => {
    const client = await connect("demo");
    const result = await client.callTool({ name: "log_weight", arguments: { kg: 71.4 } });
    await client.close();
    expect(result.isError).toBeFalsy();
    let user: Record<string, unknown> | undefined;
    for (let i = 0; i < 40; i++) {
      user = (await fs.doc(`users/${UID}`).get()).data();
      if (user?.weightKg === 71.4) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(user?.weightKg).toBe(71.4);
    expect(typeof user?.weightUpdatedAt).toBe("number");
  }, 60_000);

  it("refuses a user who is not on the allowlist", async () => {
    const client = await connect("maya");
    const result = await client.callTool({ name: "log_meal", arguments: { mealType: "snack", items: [{ name: "apple" }] } });
    await client.close();
    expect(result.isError).toBe(true);
    const meals = await fs.collectionGroup("meals").get();
    expect(meals.docs.every((d) => d.ref.path.startsWith(`users/${UID}/`))).toBe(true);
  });
});
