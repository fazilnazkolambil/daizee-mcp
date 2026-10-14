import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server/main.js";
import { MAX_SPOKEN_WORDS } from "../src/server/spoken.js";

function setup() {
  const app = buildApp({ demo: true });
  return { ...app, svc: app.service };
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function expectVoiceSafe(spoken: string): void {
  expect(wordCount(spoken)).toBeLessThanOrEqual(MAX_SPOKEN_WORDS);
  expect(spoken).not.toMatch(/[*_`#|>~]/);
  expect(spoken.length).toBeGreaterThan(0);
}

describe("day progress", () => {
  it("shows Maya's progress and a check-in for the expiring knee note", async () => {
    const { svc } = setup();
    const out = await svc.dayProgress("maya");
    expect(out.mealsLogged).toBe(1);
    expect(out.eaten.calories).toBe(250);
    expect(out.remaining.calories).toBe(1800 - 250);
    expect(out.checkIns).toHaveLength(1);
    expect(out.checkIns[0]?.text).toBe("left knee is sore");
    expectVoiceSafe(out.spoken);
  });

  it("starts empty for the blank user", async () => {
    const { svc } = setup();
    const out = await svc.dayProgress("sam");
    expect(out.mealsLogged).toBe(0);
    expect(out.checkIns).toEqual([]);
    expectVoiceSafe(out.spoken);
  });

  it("fails clearly for an unknown user", async () => {
    const { svc } = setup();
    await expect(svc.dayProgress("nobody")).rejects.toThrow(/Unknown demo user/);
  });
});

describe("log meal and the safety check", () => {
  it("flags pad thai against Maya's peanut allergy and names the memory", async () => {
    const { svc } = setup();
    const out = await svc.logMeal("maya", { mealType: "dinner", items: [{ name: "pad thai" }] });
    expect(out.safetyFlags).toHaveLength(1);
    expect(out.safetyFlags[0]).toMatchObject({ memoryText: "allergic to peanuts", category: "allergy", severity: "warning" });
    expect(out.spoken).toMatch(/allerg/i);
    expectVoiceSafe(out.spoken);
  });

  it("does not flag a meal that is fine", async () => {
    const { svc } = setup();
    const out = await svc.logMeal("maya", { mealType: "lunch", items: [{ name: "dal" }, { name: "rice" }] });
    expect(out.safetyFlags).toEqual([]);
  });

  it("catches an allergy mentioned in different words", async () => {
    const { svc } = setup();
    const out = await svc.logMeal("maya", { mealType: "snack", items: [{ name: "groundnut chikki" }] });
    expect(out.safetyFlags).toHaveLength(1);
  });

  it("is idempotent: logging the same meal twice does not double count", async () => {
    const { svc } = setup();
    const a = await svc.logMeal("maya", { mealType: "lunch", items: [{ name: "chicken biryani" }] });
    const b = await svc.logMeal("maya", { mealType: "lunch", items: [{ name: "chicken biryani" }] });
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.mealId).toBe(a.mealId);
    expect(b.totalsToday.calories).toBe(a.totalsToday.calories);
    expectVoiceSafe(b.spoken);
  });

  it("uses supplied totals as given and flags guessed numbers as estimates", async () => {
    const { svc } = setup();
    const out = await svc.logMeal("sam", {
      mealType: "dinner",
      items: [{ name: "mystery stew" }, { name: "idli", quantity: 2 }, { name: "my special", calories: 400, protein: 20 }],
    });
    expect(out.estimatedItems).toEqual(["mystery stew", "idli"]);
    expect(out.mealTotals.calories).toBe(250 + 240 + 400);
    expectVoiceSafe(out.spoken);
  });

  it("respects a vegetarian diet note", async () => {
    const { svc } = setup();
    await svc.remember("sam", { category: "constraint", text: "vegetarian" });
    const out = await svc.logMeal("sam", { mealType: "dinner", items: [{ name: "chicken curry" }] });
    expect(out.safetyFlags[0]?.reason).toMatch(/vegetarian/);
  });
});

describe("memory across a fresh conversation, and over time", () => {
  it("teaches Sam by voice, then still warns after a 'new conversation'", async () => {
    const { svc } = setup();
    const a = await svc.remember("sam", { category: "allergy", text: "allergic to peanuts" });
    const b = await svc.remember("sam", { category: "symptom", text: "left knee is sore this week" });
    expect(a.outcome).toBe("saved");
    expect(b.outcome).toBe("saved");
    // "New conversation" only clears the assistant's own history. This service holds the memory.
    const meal = await svc.logMeal("sam", { mealType: "dinner", items: [{ name: "pad thai" }] });
    expect(meal.safetyFlags[0]?.memoryText).toBe("allergic to peanuts");
  });

  it("lets a sore knee expire while the allergy remains", async () => {
    const { svc, clock } = setup();
    expect((await svc.recall("maya")).memories.map((m) => m.text)).toContain("left knee is sore");
    clock.advanceDays(6);
    const after = await svc.recall("maya");
    const texts = after.memories.map((m) => m.text);
    expect(texts).not.toContain("left knee is sore");
    expect(texts).toContain("allergic to peanuts");
    expectVoiceSafe(after.spoken);
  });

  it("raises a check-in as the knee note nears its end", async () => {
    const { svc, clock } = setup();
    clock.advanceDays(1);
    const out = await svc.dayProgress("maya");
    expect(out.checkIns[0]?.expiresInDays).toBe(1);
    expect(out.spoken).toMatch(/still true/);
  });

  it("recalls allergies first", async () => {
    const { svc } = setup();
    const out = await svc.recall("maya");
    expect(out.memories[0]?.category).toBe("allergy");
    expect(out.memories.length).toBeLessThanOrEqual(5);
  });

  it("keeps a repeated fact fresh instead of duplicating it", async () => {
    const { svc } = setup();
    const out = await svc.remember("maya", { category: "symptom", text: "Left knee is sore" });
    expect(out.outcome).toBe("refreshed");
    const memories = (await svc.recall("maya")).memories.filter((m) => /knee/.test(m.text));
    expect(memories).toHaveLength(1);
  });

  it("asks for confirmation when the assistant is unsure", async () => {
    const { svc } = setup();
    const out = await svc.remember("sam", { category: "constraint", text: "maybe vegan", confidence: 0.3 });
    expect(out.outcome).toBe("needs_confirmation");
    expect((await svc.recall("sam")).memories).toHaveLength(0);
  });
});

describe("resolve: two steps, never by accident", () => {
  it("asks first, then forgets only after confirmation", async () => {
    const { svc } = setup();
    const ask = await svc.resolve("maya", { query: "knee" });
    expect(ask.outcome).toBe("needs_confirmation");
    expect((await svc.recall("maya")).memories.map((m) => m.text)).toContain("left knee is sore");

    const done = await svc.resolve("maya", { query: "knee", confirm: true });
    expect(done.outcome).toBe("resolved");
    expect((await svc.recall("maya")).memories.map((m) => m.text)).not.toContain("left knee is sore");
  });

  it("is extra careful with allergies", async () => {
    const { svc } = setup();
    const ask = await svc.resolve("maya", { query: "peanuts" });
    expect(ask.outcome).toBe("needs_confirmation");
    expect(ask.spoken).toMatch(/allergy/i);
  });

  it("reports when nothing matches", async () => {
    const { svc } = setup();
    expect((await svc.resolve("maya", { query: "astronomy" })).outcome).toBe("not_found");
  });

  it("cannot touch another user's notes", async () => {
    const { svc } = setup();
    const mayaMemory = (await svc.recall("maya")).memories[0];
    const out = await svc.resolve("sam", { memoryId: mayaMemory?.id, confirm: true });
    expect(out.outcome).toBe("not_found");
    expect((await svc.recall("maya")).memories.length).toBeGreaterThan(0);
  });
});

describe("weight", () => {
  it("never speaks the number, but returns it as data", async () => {
    const { svc } = setup();
    const out = await svc.logWeight("sam", { kg: 70.4 });
    expect(out.kg).toBe(70.4);
    expect(out.spoken).not.toMatch(/70/);
    expectVoiceSafe(out.spoken);
  });

  it("replaces a second weigh-in on the same day", async () => {
    const { svc } = setup();
    await svc.logWeight("sam", { kg: 70 });
    const out = await svc.logWeight("sam", { kg: 69.8 });
    expect(out.outcome).toBe("replaced");
  });

  it("asks to confirm a huge jump", async () => {
    const { svc } = setup();
    const out = await svc.logWeight("maya", { kg: 90 });
    expect(out.outcome).toBe("needs_confirmation");
    const confirmed = await svc.logWeight("maya", { kg: 90, confirm: true });
    expect(confirmed.outcome).toBe("saved");
  });
});

describe("demo reset", () => {
  it("puts everything back", async () => {
    const { svc, store, clock } = setup();
    await svc.logMeal("sam", { mealType: "lunch", items: [{ name: "dal" }] });
    clock.advanceDays(5);
    clock.reset();
    await store.reset();
    expect((await svc.dayProgress("sam")).mealsLogged).toBe(0);
  });
});
