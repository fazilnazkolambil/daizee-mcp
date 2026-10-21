import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  ManualClock,
  MAX_OPS_PER_CALL,
  MIN_CONFIDENCE,
  categoryPriority,
  isSameFact,
  normalizeCategory,
  pickExpiring,
  planOps,
  parseDurationDays,
  resolveTtlDays,
  selectActive,
  toView,
  type Memory,
} from "../src/memory/index.js";

const NOW = 1_800_000_000_000;

function mem(partial: Partial<Memory> & Pick<Memory, "id" | "text" | "category">): Memory {
  const ttlDays = partial.ttlDays ?? 10;
  return {
    confidence: 0.9,
    status: "active",
    ttlDays,
    createdAtMs: NOW,
    expiresAtMs: NOW + ttlDays * DAY_MS,
    ...partial,
  };
}

let counter = 0;
const newId = () => `m${++counter}`;

describe("category rules", () => {
  it("orders safety-critical facts first", () => {
    const order = ["allergy", "constraint", "coach_preference", "symptom", "habit", "food_preference", "goal"];
    const priorities = order.map(categoryPriority);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
    expect(new Set(priorities).size).toBe(order.length);
  });

  it("maps the legacy 'preference' category to food_preference", () => {
    expect(normalizeCategory("preference")).toBe("food_preference");
    expect(categoryPriority("preference")).toBe(categoryPriority("food_preference"));
  });

  it("uses the app's TTL table", () => {
    expect(resolveTtlDays("symptom")).toBe(5);
    expect(resolveTtlDays("constraint")).toBe(30);
    expect(resolveTtlDays("goal")).toBe(60);
    expect(resolveTtlDays("habit")).toBe(60);
    expect(resolveTtlDays("food_preference")).toBe(90);
    expect(resolveTtlDays("coach_preference")).toBe(180);
    expect(resolveTtlDays("allergy")).toBe(365);
    expect(resolveTtlDays("unheard-of")).toBe(14);
  });

  it("lets an explicit duration win, rounded and clamped to 1..365", () => {
    expect(resolveTtlDays("symptom", 7)).toBe(7);
    expect(resolveTtlDays("symptom", 0.2)).toBe(1);
    expect(resolveTtlDays("symptom", 9999)).toBe(365);
    expect(resolveTtlDays("symptom", -3)).toBe(5);
  });
});

describe("parseDurationDays", () => {
  it("reads day counts from natural phrasing", () => {
    expect(parseDurationDays("traveling to Kerala for 2 days")).toBe(2);
    expect(parseDurationDays("I'm going to Dubai for two weeks")).toBe(14);
    expect(parseDurationDays("away for a couple of weeks")).toBe(14);
    expect(parseDurationDays("on a diet for three months")).toBe(90);
    expect(parseDurationDays("I have two kids")).toBeUndefined(); // a number word alone is not a duration
    expect(parseDurationDays("Going for 14 days")).toBe(14);
    expect(parseDurationDays("3-day trip")).toBe(3);
  });

  it("reads weeks and months", () => {
    expect(parseDurationDays("sore this week")).toBe(7);
    expect(parseDurationDays("for 2 weeks")).toBe(14);
    expect(parseDurationDays("for a month")).toBe(30);
    expect(parseDurationDays("for a year")).toBe(365);
  });

  it("returns undefined when no duration unit is present", () => {
    expect(parseDurationDays("allergic to peanuts")).toBeUndefined();
    expect(parseDurationDays("walks after dinner")).toBeUndefined();
  });

  it("clamps out-of-range values", () => {
    expect(parseDurationDays("for 500 days")).toBe(365);
  });
});

describe("isSameFact", () => {
  it("matches identical text ignoring case and punctuation", () => {
    expect(isSameFact({ text: "Allergic to peanuts!", category: "allergy" }, { text: "allergic to peanuts", category: "allergy" })).toBe(true);
  });
  it("matches containment inside one category only", () => {
    expect(isSameFact({ text: "vegetarian", category: "constraint" }, { text: "is vegetarian", category: "constraint" })).toBe(true);
    expect(isSameFact({ text: "vegetarian", category: "constraint" }, { text: "is vegetarian", category: "habit" })).toBe(false);
  });
  it("never matches empty text", () => {
    expect(isSameFact({ text: "", category: "habit" }, { text: "", category: "habit" })).toBe(false);
  });
});

describe("selectActive", () => {
  it("keeps an old allergy ahead of newer preferences", () => {
    const allergy = mem({ id: "a", text: "peanut allergy", category: "allergy", createdAtMs: NOW - 200 * DAY_MS, expiresAtMs: NOW + 165 * DAY_MS });
    const prefs = Array.from({ length: 12 }, (_, i) =>
      mem({ id: `p${i}`, text: `likes dish ${i}`, category: "food_preference", createdAtMs: NOW - i * 1000 }),
    );
    const out = selectActive([...prefs, allergy], NOW, 5);
    expect(out[0]?.id).toBe("a");
    expect(out).toHaveLength(5);
  });

  it("hides expired and resolved memories", () => {
    const live = mem({ id: "l", text: "sore knee", category: "symptom" });
    const expired = mem({ id: "e", text: "old note", category: "symptom", expiresAtMs: NOW - 1 });
    const resolved = mem({ id: "r", text: "done", category: "symptom", status: "resolved" });
    expect(selectActive([live, expired, resolved], NOW).map((m) => m.id)).toEqual(["l"]);
  });

  it("reports age and days left in the view", () => {
    const m = mem({ id: "k", text: "sore knee", category: "symptom", createdAtMs: NOW - 2 * DAY_MS, expiresAtMs: NOW + 3 * DAY_MS - 1 });
    expect(toView(m, NOW)).toMatchObject({ ageDays: 2, expiresInDays: 3 });
  });
});

describe("pickExpiring (check-ins)", () => {
  it("offers symptoms ending within 72 hours, soonest first, max 2", () => {
    const a = mem({ id: "a", text: "knee", category: "symptom", expiresAtMs: NOW + 2 * DAY_MS });
    const b = mem({ id: "b", text: "cold", category: "symptom", expiresAtMs: NOW + 1 * DAY_MS });
    const c = mem({ id: "c", text: "no sugar", category: "constraint", expiresAtMs: NOW + 2.5 * DAY_MS });
    expect(pickExpiring([a, b, c], NOW).map((m) => m.id)).toEqual(["b", "a"]);
  });
  it("checks in on an allergy only in the last 30 days of its life, so the safety net never drops silently", () => {
    const ending = mem({ id: "a", text: "peanuts", category: "allergy", expiresAtMs: NOW + 20 * DAY_MS });
    const distant = mem({ id: "b", text: "shellfish", category: "allergy", expiresAtMs: NOW + 200 * DAY_MS });
    expect(pickExpiring([ending, distant], NOW).map((m) => m.id)).toEqual(["a"]);
  });
  it("does not check in on far-off memories or on preferences", () => {
    const far = mem({ id: "f", text: "knee", category: "symptom", expiresAtMs: NOW + 10 * DAY_MS });
    const pref = mem({ id: "p", text: "likes paneer", category: "food_preference", expiresAtMs: NOW + 1 * DAY_MS });
    expect(pickExpiring([far, pref], NOW)).toEqual([]);
  });
});

describe("planOps", () => {
  it("adds a new fact with the category's TTL", () => {
    const plan = planOps({ known: [], ops: [{ text: "left knee is sore", category: "symptom", confidence: 0.9 }], nowMs: NOW, newId });
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0]).toMatchObject({ category: "symptom", ttlDays: 5, status: "active", expiresAtMs: NOW + 5 * DAY_MS });
    expect(plan.result.added).toHaveLength(1);
  });

  it("refreshes instead of duplicating a repeated fact", () => {
    const known = [mem({ id: "k", text: "left knee is sore", category: "symptom", expiresAtMs: NOW + 1 * DAY_MS })];
    const plan = planOps({ known, ops: [{ text: "Left knee is sore", category: "symptom", confidence: 0.9 }], nowMs: NOW, newId });
    expect(plan.creates).toHaveLength(0);
    expect(plan.result.refreshed).toEqual(["k"]);
    expect(plan.patches[0]?.patch.expiresAtMs).toBe(NOW + 5 * DAY_MS);
  });

  it("dedupes within a single call", () => {
    const plan = planOps({
      known: [],
      ops: [
        { text: "vegetarian", category: "constraint", confidence: 0.9 },
        { text: "is vegetarian", category: "constraint", confidence: 0.9 },
      ],
      nowMs: NOW,
      newId,
    });
    expect(plan.creates).toHaveLength(1);
  });

  it("drops low-confidence ops and reports them so the caller can ask", () => {
    const plan = planOps({ known: [], ops: [{ text: "maybe vegan", category: "constraint", confidence: MIN_CONFIDENCE - 0.01 }], nowMs: NOW, newId });
    expect(plan.creates).toHaveLength(0);
    expect(plan.result.lowConfidence).toBe(1);
  });

  it("caps a call at three ops", () => {
    const ops = Array.from({ length: 5 }, (_, i) => ({ text: `fact number ${i}`, category: "habit", confidence: 0.9 }));
    const plan = planOps({ known: [], ops, nowMs: NOW, newId });
    expect(plan.creates).toHaveLength(MAX_OPS_PER_CALL);
    expect(plan.result.rejected).toBe(2);
  });

  it("resolves a known memory and keeps it one more day", () => {
    const known = [mem({ id: "k", text: "left knee is sore", category: "symptom" })];
    const plan = planOps({ known, ops: [{ op: "resolve", id: "k", confidence: 0.9 }], nowMs: NOW, newId });
    expect(plan.result.resolved).toEqual(["k"]);
    expect(plan.patches[0]?.patch).toMatchObject({ status: "resolved", expiresAtMs: NOW + DAY_MS });
  });

  it("refuses to update or resolve an id it was never shown", () => {
    const plan = planOps({
      known: [],
      ops: [
        { op: "resolve", id: "ghost", confidence: 0.9 },
        { op: "update", id: "ghost", text: "x", category: "habit", confidence: 0.9 },
      ],
      nowMs: NOW,
      newId,
    });
    expect(plan.patches).toHaveLength(0);
    expect(plan.result.rejected).toBe(2);
  });

  it("updates text and refreshes the life of a known memory", () => {
    const known = [mem({ id: "k", text: "vegetarian", category: "constraint" })];
    const plan = planOps({ known, ops: [{ op: "update", id: "k", text: "now vegan", category: "constraint", confidence: 0.9 }], nowMs: NOW, newId });
    expect(plan.result.updated).toEqual(["k"]);
    expect(plan.patches[0]?.patch).toMatchObject({ text: "now vegan", ttlDays: 30 });
  });

  it("rejects unknown categories and empty text", () => {
    const plan = planOps({
      known: [],
      ops: [
        { text: "something", category: "astrology", confidence: 0.9 },
        { text: "   ", category: "habit", confidence: 0.9 },
      ],
      nowMs: NOW,
      newId,
    });
    expect(plan.creates).toHaveLength(0);
    expect(plan.result.rejected).toBe(2);
  });
});

describe("ManualClock", () => {
  it("moves forward by whole days and never backwards", () => {
    const clock = new ManualClock({ now: () => NOW });
    expect(clock.now()).toBe(NOW);
    clock.advanceDays(3);
    expect(clock.now()).toBe(NOW + 3 * DAY_MS);
    expect(clock.advancedDays).toBe(3);
    expect(() => clock.advanceDays(-1)).toThrow(RangeError);
  });
});
