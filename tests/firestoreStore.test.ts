import { describe, expect, it } from "vitest";
import { ManualClock, type Clock } from "../src/memory/index.js";
import { buildApp } from "../src/server/main.js";
import { MAX_SPOKEN_WORDS } from "../src/server/spoken.js";
import { allowlistGuard, dayKeyFor, FirestoreStore, firestoreSettings, ForbiddenPathError, parseAllowedUids } from "../src/store/index.js";
import { FakeDocDb } from "./fakeDocDb.js";

/**
 * FirestoreStore against a fake Firestore: proves the documents have exactly
 * the shapes the DayZer0 app and its Cloud Functions read. All ids are invented.
 */

const UID = "test-uid-demo";
const OTHER_UID = "someone-else";
const TZ = "Asia/Kolkata";
const FIXED_NOW = Date.parse("2026-10-20T04:30:00Z"); // 10:00 in Kolkata

function setup(nowMs = FIXED_NOW) {
  const db = new FakeDocDb();
  db.docs.set(`users/${UID}`, {
    name: "Demo",
    timezone: TZ,
    targetCalories: 2000,
    proteinGoal: 120,
    carbsGoal: 220,
    fatGoal: 60,
  });
  db.docs.set(`users/${OTHER_UID}`, { name: "Not allowed", timezone: TZ, targetCalories: 1500 });
  const base: Clock = { now: () => nowMs };
  const clock = new ManualClock(base);
  const store = new FirestoreStore(db, new Map([["demo", UID]]), clock);
  const app = buildApp({ demo: true, live: { store, clock, defaultUser: "demo" } });
  return { db, store, clock, svc: app.service, handler: app.handler };
}

const today = dayKeyFor(FIXED_NOW, TZ);

describe("FirestoreStore: meals in the app's shape", () => {
  it("log_meal writes users/{uid}/meals/{id} the way the app's MealModel and onMealWritten read it", async () => {
    const { db, svc } = setup();
    const out = await svc.logMeal("demo", {
      mealType: "breakfast",
      items: [{ name: "idli", quantity: 2, calories: 240, protein: 8, carbs: 48, fat: 1 }, { name: "sambar" }],
    });
    const doc = db.docs.get(`users/${UID}/meals/${out.mealId}`);
    expect(doc).toBeDefined();
    expect(doc).toMatchObject({
      id: out.mealId,
      mealType: "BREAKFAST",
      photoUrls: [],
      photoPaths: [],
      fiber: 0,
      editedByUser: false,
      createdAt: FIXED_NOW, // epoch ms, as the triggers' range query expects
      source: "alexa", // not "chat", so the app's trigger posts a card in today's Daizee chat
    });
    expect(doc?.totalCalories).toBe(out.mealTotals.calories);
    expect(doc?.protein).toBe(out.mealTotals.protein);
    const foods = doc?.foods as Array<Record<string, unknown>>;
    expect(foods).toHaveLength(2);
    expect(foods[0]).toMatchObject({ id: "food_0", name: "idli", category: "other", quantity: 2, unit: "serving", step: 1, calories: 240, protein: 8, carbs: 48, fat: 1 });
    expect(foods[1]?.estimated).toBe(true);
    // Totals are the app's job: this service never writes the daily doc.
    expect([...db.docs.keys()].some((k) => k.includes("/daily/"))).toBe(false);
    expect(out.spoken.split(" ").length).toBeLessThanOrEqual(MAX_SPOKEN_WORDS);
  });

  it("does not log the same meal twice, and reads today's meals back for progress", async () => {
    const { db, svc } = setup();
    const meal = { mealType: "lunch" as const, items: [{ name: "dal", calories: 180, protein: 10, carbs: 26, fat: 4 }] };
    const first = await svc.logMeal("demo", meal);
    const again = await svc.logMeal("demo", meal);
    expect(again.duplicate).toBe(true);
    expect(again.mealId).toBe(first.mealId);
    expect([...db.docs.keys()].filter((k) => k.startsWith(`users/${UID}/meals/`))).toHaveLength(1);

    // A meal the user logged in the app itself counts too.
    db.docs.set(`users/${UID}/meals/app-meal`, {
      id: "app-meal", mealType: "SNACK", foods: [{ name: "banana", quantity: 1, calories: 100, protein: 1, carbs: 25, fat: 0 }],
      totalCalories: 100, protein: 1, carbs: 25, fat: 0, createdAt: FIXED_NOW - 60_000, source: "app",
    });
    // And yesterday's does not.
    db.docs.set(`users/${UID}/meals/old`, { id: "old", mealType: "DINNER", foods: [{ name: "x", calories: 900 }], createdAt: FIXED_NOW - 86_400_000 });

    const progress = await svc.dayProgress("demo");
    expect(progress.mealsLogged).toBe(2);
    expect(progress.eaten.calories).toBe(280);
    expect(progress.targets.calories).toBe(2000);
  });

  it("falls back to today's daily targets when the profile has none yet", async () => {
    const { db, svc } = setup();
    db.docs.set(`users/${UID}`, { name: "Demo", timezone: TZ });
    db.docs.set(`users/${UID}/daily/${today}`, { targets: { calories: 1900, protein: 100, carbs: 200, fat: 55, steps: 8000 } });
    expect((await svc.dayProgress("demo")).targets).toEqual({ calories: 1900, protein: 100, carbs: 200, fat: 55 });
  });
});

describe("FirestoreStore: weight and memories", () => {
  it("writes one weigh-in a day at weightLogs/weight_{date}, like the app", async () => {
    const { db, svc } = setup();
    db.docs.set(`users/${UID}/weightLogs/weight_2026-10-13`, { weightKg: 71.2, recordedAt: FIXED_NOW - 7 * 86_400_000, source: "app" });
    const first = await svc.logWeight("demo", { kg: 70.8 });
    expect(first.outcome).toBe("saved");
    expect(first.previousKg).toBe(71.2);
    expect(db.docs.get(`users/${UID}/weightLogs/weight_${today}`)).toEqual({ weightKg: 70.8, recordedAt: FIXED_NOW, source: "alexa", quotaClaimed: false });
    const second = await svc.logWeight("demo", { kg: 70.6 });
    expect(second.outcome).toBe("replaced");
    expect([...db.docs.keys()].filter((k) => k.includes("/weightLogs/"))).toHaveLength(2);
  });

  it("saves notes with the app's memory fields, reads the app's own notes, and forgets in two steps", async () => {
    const { db, svc } = setup();
    // A note the app's chat saved earlier, with its legacy "preference" category.
    db.docs.set(`users/${UID}/memories/app-note`, {
      text: "likes filter coffee", category: "preference", confidence: 0.8, status: "active", ttlDays: 90,
      createdAtMs: FIXED_NOW - 86_400_000, expiresAtMs: FIXED_NOW + 89 * 86_400_000, createdAt: new Date(FIXED_NOW - 86_400_000),
    });
    const saved = await svc.remember("demo", { category: "symptom", text: "left knee is sore" });
    expect(saved.outcome).toBe("saved");
    const id = saved.memory?.id as string;
    const doc = db.docs.get(`users/${UID}/memories/${id}`);
    expect(doc).toMatchObject({ text: "left knee is sore", category: "symptom", status: "active", ttlDays: 5, source: "alexa", createdAtMs: FIXED_NOW });
    expect(doc?.expiresAt).toBeInstanceOf(Date);
    expect(doc?.createdAt).toBeInstanceOf(Date);

    const recall = await svc.recall("demo");
    expect(recall.memories.map((m) => m.text).sort()).toEqual(["left knee is sore", "likes filter coffee"]);
    expect(recall.memories.find((m) => m.text === "likes filter coffee")?.category).toBe("food_preference");

    expect((await svc.resolve("demo", { query: "knee", confirm: true })).outcome).toBe("needs_confirmation");
    expect((await svc.resolve("demo", { query: "knee", confirm: true })).outcome).toBe("resolved");
    expect(db.docs.get(`users/${UID}/memories/${id}`)).toMatchObject({ status: "resolved", resolvedAtMs: FIXED_NOW });
    expect((await svc.recall("demo")).memories.map((m) => m.text)).toEqual(["likes filter coffee"]);
  });
});

describe("FirestoreStore: today's plan", () => {
  it("reads todays_mission and the afternoon nudge from the daily doc", async () => {
    const { db, svc } = setup();
    db.docs.set(`users/${UID}/daily/${today}`, {
      todays_mission: {
        focus: { title: "Hit your protein", why: "You were short three days running." },
        plan: { eat: "Eggs at breakfast, paneer at lunch", move: "A 20 minute walk", recover: "Bed by 11" },
        summary: "Protein first today.",
        queries: ["a", "b", "c", "d"],
        source: "rules",
        createdAt: FIXED_NOW,
      },
      afternoon: { headline: "Lunch check", body: "Log lunch to stay on track.", cta: { label: "Log", action: "capture_meal" }, createdAt: FIXED_NOW },
    });
    const out = await svc.todayPlan("demo");
    expect(out.hasPlan).toBe(true);
    expect(out.focus?.title).toBe("Hit your protein");
    expect(out.plan?.eat).toBe("Eggs at breakfast, paneer at lunch");
    expect(out.afternoon?.headline).toBe("Lunch check");
    expect(out.spoken).toMatch(/^Your focus today: Hit your protein\. Eat: .*Move: .*Recover: Bed by 11\./);
    expect(out.spoken).toMatch(/This afternoon: Lunch check\./);
  });

  it("handles an older doc with only a summary, and a day with no doc", async () => {
    const { db, svc } = setup();
    expect((await svc.todayPlan("demo")).hasPlan).toBe(false);
    db.docs.set(`users/${UID}/daily/${today}`, { todays_mission: { headline: "Welcome", body: "Let's start with breakfast.", summary: "" } });
    const out = await svc.todayPlan("demo");
    expect(out.hasPlan).toBe(true);
    expect(out.plan).toBeNull();
    expect(out.spoken).toBe("Let's start with breakfast.");
  });
});

describe("only allowed accounts are ever touched", () => {
  it("refuses any user name that is not on the allowlist, without reading anything", async () => {
    const { db, svc } = setup();
    for (const name of ["maya", UID, OTHER_UID, "../users/someone-else"]) {
      await expect(svc.dayProgress(name)).rejects.toThrow(/Unknown demo user/);
      await expect(svc.logMeal(name, { mealType: "snack", items: [{ name: "apple" }] })).rejects.toThrow();
    }
    expect(db.touched.every((p) => p.startsWith(`users/${UID}`))).toBe(true);
    expect(db.touched.some((p) => p.includes(OTHER_UID))).toBe(false);
  });

  it("guards every path, even if the store had a bug", async () => {
    const guarded = allowlistGuard(new FakeDocDb(), [UID]);
    await expect(guarded.get(`users/${OTHER_UID}`)).rejects.toBeInstanceOf(ForbiddenPathError);
    await expect(guarded.set(`users/${UID}/../${OTHER_UID}/meals/x`, {})).rejects.toBeInstanceOf(ForbiddenPathError);
    await expect(guarded.query("users", {})).rejects.toBeInstanceOf(ForbiddenPathError);
    await expect(guarded.get(`users/${UID}/meals/x`)).resolves.toBeNull();
  });

  it("turns off the demo's time travel and reset over HTTP", async () => {
    const { handler } = setup();
    const { createServer } = await import("node:http");
    const server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const port = (server.address() as { port: number }).port;
    for (const path of ["/demo/advance-clock", "/demo/reset"]) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", body: JSON.stringify({ days: 3 }) });
      expect(res.status).toBe(409);
    }
    await new Promise<void>((ok) => server.close(() => ok()));
  });
});

describe("settings", () => {
  it("parses name=uid pairs and rejects odd input", () => {
    expect([...parseAllowedUids(" demo=abc123 , solo ")]).toEqual([["demo", "abc123"], ["solo", "solo"]]);
    expect(parseAllowedUids("").size).toBe(0);
    expect(() => parseAllowedUids("demo=a/b")).toThrow(/bad entry/);
  });

  it("needs a project, an allowlist, and an explicit yes before using a real project", () => {
    const ok = { FIREBASE_PROJECT_ID: "p", DAIZEE_ALLOWED_UIDS: "demo=u1" };
    expect(() => firestoreSettings({})).toThrow(/FIREBASE_PROJECT_ID/);
    expect(() => firestoreSettings({ FIREBASE_PROJECT_ID: "p" })).toThrow(/DAIZEE_ALLOWED_UIDS/);
    expect(() => firestoreSettings(ok)).toThrow(/DAIZEE_ALLOW_LIVE_FIRESTORE/);
    expect(firestoreSettings({ ...ok, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }).emulator).toBe(true);
    expect(firestoreSettings({ ...ok, DAIZEE_ALLOW_LIVE_FIRESTORE: "1" }).emulator).toBe(false);
  });
});
