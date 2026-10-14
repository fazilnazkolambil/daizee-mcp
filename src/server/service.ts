import { createHash } from "node:crypto";
import {
  isSameFact,
  normalizeText,
  pickExpiring,
  planOps,
  selectActive,
  toView,
  type Clock,
  type Memory,
  type MemoryCategory,
  type MemoryView,
} from "../memory/index.js";
import { dayKeyFor } from "../store/dayKey.js";
import { newId } from "../store/inMemoryStore.js";
import type { Meal, MealItem, MealType, Store, Targets } from "../store/types.js";
import type { AllergenRule, Dish } from "./data.js";
import { checkMeal, matchDish, tokens } from "./safety.js";
import { lifespan, plural, round, spoken } from "./spoken.js";

/**
 * All the behaviour behind the tools, with no MCP in it. The tools are thin
 * wrappers, so this can be tested on its own.
 *
 * Deliberately NO language model in here: every call is quick and predictable,
 * and the assistant (not this service) does the talking and the understanding.
 */

export interface MealItemInput {
  name: string;
  quantity?: number;
  /** If given, these are TOTALS for this item (not per unit). */
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

const ESTIMATE = { calories: 250, protein: 10, carbs: 30, fat: 10 };
const BIG_WEIGHT_JUMP_KG = 5;
const MEAL_SOURCE = "alexa";

export class UserNotFoundError extends Error {
  constructor(userId: string) {
    super(`Unknown demo user: ${userId}`);
    this.name = "UserNotFoundError";
  }
}

export class DaizeeService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
    private readonly dishes: readonly Dish[],
    private readonly rules: readonly AllergenRule[],
  ) {}

  private async profile(userId: string) {
    const profile = await this.store.getProfile(userId);
    if (!profile) throw new UserNotFoundError(userId);
    return profile;
  }

  private async activeMemories(userId: string, limit = 40): Promise<Memory[]> {
    return selectActive(await this.store.listMemories(userId), this.clock.now(), limit);
  }

  // ── Day progress ────────────────────────────────────────────────────────

  async dayProgress(userId: string) {
    const profile = await this.profile(userId);
    const now = this.clock.now();
    const dayKey = dayKeyFor(now, profile.timezone);
    const meals = await this.store.mealsForDay(userId, dayKey);
    const eaten = sumMeals(meals);
    const remaining = subtract(profile.targets, eaten);

    const expiring = pickExpiring(await this.activeMemories(userId), now);
    const checkIns = expiring.map((m) => {
      const view = toView(m, now);
      return {
        memoryId: m.id,
        text: m.text,
        expiresInDays: view.expiresInDays,
        question: `Your note "${m.text}" ends in ${plural(view.expiresInDays, "day")}. Is it still true?`,
      };
    });

    const over = remaining.calories < 0;
    return {
      dayKey,
      eaten,
      targets: profile.targets,
      remaining,
      mealsLogged: meals.length,
      checkIns,
      spoken: spoken(
        meals.length === 0
          ? `Nothing logged yet today. Your goal is ${profile.targets.calories} calories.`
          : `You've had ${eaten.calories} of ${profile.targets.calories} calories and ${eaten.protein} of ${profile.targets.protein} grams of protein.`,
        meals.length > 0 &&
          (over
            ? `You're ${-remaining.calories} calories over.`
            : `That leaves ${remaining.calories} calories.`),
        checkIns[0] && checkIns[0].question,
      ),
    };
  }

  // ── Log a meal ──────────────────────────────────────────────────────────

  async logMeal(
    userId: string,
    input: { mealType: MealType; items: MealItemInput[]; idempotencyKey?: string },
  ) {
    const profile = await this.profile(userId);
    const now = this.clock.now();
    const dayKey = dayKeyFor(now, profile.timezone);
    const items = input.items.map((it) => this.resolveItem(it));

    const id = `meal-${hash(
      input.idempotencyKey ??
        [userId, dayKey, input.mealType, ...items.map((i) => `${normalizeText(i.name)}x${i.quantity}`).sort()].join("|"),
    )}`;

    const { meal, duplicate } = await this.store.addMeal({
      id,
      userId,
      mealType: input.mealType,
      dayKey,
      loggedAtMs: now,
      items,
      source: MEAL_SOURCE,
    });

    const memories = await this.activeMemories(userId);
    const safetyFlags = checkMeal({ items: meal.items, memories, rules: this.rules, dishes: this.dishes });

    const meals = await this.store.mealsForDay(userId, dayKey);
    const totals = sumMeals(meals);
    const remaining = subtract(profile.targets, totals);
    const mealTotals = sumItems(meal.items);
    const estimatedItems = meal.items.filter((i) => i.estimated).map((i) => i.name);

    const first = safetyFlags[0];
    return {
      mealId: meal.id,
      duplicate,
      mealType: meal.mealType,
      mealTotals,
      totalsToday: totals,
      remaining,
      estimatedItems,
      safetyFlags,
      spoken: spoken(
        duplicate
          ? `That ${meal.mealType} was already logged.`
          : `Logged your ${meal.mealType}, about ${mealTotals.calories} calories.`,
        first &&
          `Heads up: ${first.reason}. Your note says ${first.memoryText}. This is only a reminder, so please check.`,
        !first && estimatedItems.length > 0 && `I guessed the numbers for ${estimatedItems.join(" and ")}.`,
        remaining.calories >= 0
          ? `${remaining.calories} calories left today.`
          : `You're ${-remaining.calories} calories over today.`,
      ),
    };
  }

  private resolveItem(input: MealItemInput): MealItem {
    const quantity = input.quantity && input.quantity > 0 ? input.quantity : 1;
    const name = input.name.trim().replace(/\s+/g, " ");

    if (typeof input.calories === "number") {
      return {
        name,
        quantity,
        calories: round(input.calories),
        protein: round(input.protein ?? 0, 1),
        carbs: round(input.carbs ?? 0, 1),
        fat: round(input.fat ?? 0, 1),
        estimated: false,
      };
    }
    const dish = matchDish(name, this.dishes);
    if (dish) {
      return {
        name,
        quantity,
        calories: round(dish.calories * quantity),
        protein: round(dish.protein * quantity, 1),
        carbs: round(dish.carbs * quantity, 1),
        fat: round(dish.fat * quantity, 1),
        estimated: true,
      };
    }
    return {
      name,
      quantity,
      calories: round(ESTIMATE.calories * quantity),
      protein: round(ESTIMATE.protein * quantity, 1),
      carbs: round(ESTIMATE.carbs * quantity, 1),
      fat: round(ESTIMATE.fat * quantity, 1),
      estimated: true,
    };
  }

  // ── Remember ────────────────────────────────────────────────────────────

  async remember(
    userId: string,
    input: { category: MemoryCategory; text: string; durationDays?: number; confidence?: number },
  ) {
    await this.profile(userId);
    const now = this.clock.now();
    const text = input.text.trim().replace(/\s+/g, " ");
    const known = await this.activeMemories(userId);
    const plan = planOps({
      known,
      ops: [{ op: "add", text, category: input.category, ttlDays: input.durationDays, confidence: input.confidence ?? 0.9 }],
      nowMs: now,
      newId: () => newId("mem"),
    });

    if (plan.result.lowConfidence > 0) {
      return {
        outcome: "needs_confirmation" as const,
        memory: null,
        spoken: spoken(`Just to check, should I remember that: ${text}?`),
      };
    }
    if (plan.result.rejected > 0 && !plan.creates.length && !plan.patches.length) {
      return {
        outcome: "not_saved" as const,
        memory: null,
        spoken: spoken("I couldn't save that. Could you say it a different way?"),
      };
    }

    await this.store.applyMemoryPlan(userId, plan);
    const refreshed = plan.result.refreshed.length > 0;
    const id = plan.result.added[0] ?? plan.result.refreshed[0];
    const saved = (await this.store.listMemories(userId)).find((m) => m.id === id);
    const view = saved ? toView(saved, now) : null;
    return {
      outcome: (refreshed ? "refreshed" : "saved") as "refreshed" | "saved",
      memory: view,
      spoken: spoken(
        `${refreshed ? "I already knew that, so I've kept it fresh" : "Got it, I'll remember that"}${view ? ` ${lifespan(view.expiresInDays)}` : ""}.`,
      ),
    };
  }

  // ── Recall ──────────────────────────────────────────────────────────────

  async recall(userId: string) {
    await this.profile(userId);
    const now = this.clock.now();
    const memories = (await this.activeMemories(userId, 5)).map((m) => toView(m, now));
    if (!memories.length) {
      return { memories, spoken: spoken("I don't have anything saved about you yet.") };
    }
    const lines = memories.map((m) => `${capitalize(m.text)}, ${lifespan(m.expiresInDays)}.`);
    return {
      memories,
      spoken: spoken(`I know ${plural(memories.length, "thing")}.`, ...lines),
    };
  }

  // ── Resolve (two-step forget) ───────────────────────────────────────────

  async resolve(userId: string, input: { memoryId?: string; query?: string; confirm?: boolean }) {
    await this.profile(userId);
    const now = this.clock.now();
    const active = await this.activeMemories(userId);

    let candidates: Memory[];
    if (input.memoryId) {
      candidates = active.filter((m) => m.id === input.memoryId);
    } else if (input.query) {
      candidates = findByQuery(active, input.query);
    } else {
      candidates = [];
    }

    if (candidates.length === 0) {
      return {
        outcome: "not_found" as const,
        candidates: [] as MemoryView[],
        spoken: spoken("I couldn't find a note about that."),
      };
    }
    if (candidates.length > 1) {
      const views = candidates.slice(0, 3).map((m) => toView(m, now));
      return {
        outcome: "ambiguous" as const,
        candidates: views,
        spoken: spoken("Which one do you mean?", ...views.map((v) => `${capitalize(v.text)}.`)),
      };
    }

    const target = candidates[0] as Memory;
    const view = toView(target, now);
    if (!input.confirm) {
      return {
        outcome: "needs_confirmation" as const,
        candidates: [view],
        spoken: spoken(
          target.category === "allergy"
            ? `That's an allergy note: ${target.text}. I'll only remove it if you're sure. Remove it?`
            : `Should I forget "${target.text}"?`,
        ),
      };
    }

    const plan = planOps({
      known: active,
      ops: [{ op: "resolve", id: target.id, confidence: 1 }],
      nowMs: now,
      newId: () => newId("mem"),
    });
    await this.store.applyMemoryPlan(userId, plan);
    return {
      outcome: "resolved" as const,
      candidates: [view],
      spoken: spoken(`Done. I've let go of "${target.text}".`),
    };
  }

  // ── Weight ──────────────────────────────────────────────────────────────

  async logWeight(userId: string, input: { kg: number; confirm?: boolean }) {
    const profile = await this.profile(userId);
    const now = this.clock.now();
    const dayKey = dayKeyFor(now, profile.timezone);
    const previous = (await this.store.recentWeights(userId, 5)).find((w) => w.dayKey !== dayKey);
    const delta = previous ? round(input.kg - previous.kg, 1) : null;

    if (delta !== null && Math.abs(delta) > BIG_WEIGHT_JUMP_KG && !input.confirm) {
      return {
        outcome: "needs_confirmation" as const,
        kg: input.kg,
        previousKg: previous?.kg ?? null,
        deltaKg: delta,
        spoken: spoken("That's quite different from last time. Can you confirm the number on your screen?"),
      };
    }

    const { replaced } = await this.store.upsertWeight({
      id: `${userId}-w-${dayKey}`,
      userId,
      dayKey,
      kg: input.kg,
      loggedAtMs: now,
    });
    // The number is shown on screen, never read aloud.
    return {
      outcome: (replaced ? "replaced" : "saved") as "saved" | "replaced",
      kg: input.kg,
      previousKg: previous?.kg ?? null,
      deltaKg: delta,
      spoken: spoken(
        replaced ? "Updated today's weigh-in." : "Logged today's weigh-in.",
        delta !== null && Math.abs(delta) >= 0.1 && (delta < 0 ? "That's down since last time." : "That's up since last time."),
        "The number is on your screen.",
      ),
    };
  }
}

// ── helpers ───────────────────────────────────────────────────────────────

function hash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 12);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function sumItems(items: readonly MealItem[]): Targets {
  return items.reduce<Targets>(
    (acc, i) => ({
      calories: acc.calories + i.calories,
      protein: round(acc.protein + i.protein, 1),
      carbs: round(acc.carbs + i.carbs, 1),
      fat: round(acc.fat + i.fat, 1),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

function sumMeals(meals: readonly Meal[]): Targets {
  return sumItems(meals.flatMap((m) => m.items));
}

function subtract(targets: Targets, eaten: Targets): Targets {
  return {
    calories: round(targets.calories - eaten.calories),
    protein: round(targets.protein - eaten.protein, 1),
    carbs: round(targets.carbs - eaten.carbs, 1),
    fat: round(targets.fat - eaten.fat, 1),
  };
}

const STOP_WORDS = new Set([
  "my", "the", "a", "an", "is", "are", "was", "be", "it", "its", "of", "about", "note", "notes",
  "to", "that", "this", "forget", "remove", "delete", "better", "fine", "ok", "okay", "now",
  "no", "longer", "anymore", "not", "i", "me", "you", "and", "or", "has", "have", "feel", "feels",
]);

/** Active memories that share meaningful words with what the user said. */
function findByQuery(active: readonly Memory[], query: string): Memory[] {
  const wanted = tokens(query).filter((w) => !STOP_WORDS.has(w));
  if (!wanted.length) return [];
  const scored = active
    .map((m) => {
      const have = new Set(tokens(m.text));
      const exact = isSameFact(m, { text: query, category: m.category });
      const overlap = wanted.filter((w) => have.has(w)).length;
      return { m, score: exact ? 100 : overlap };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const top = scored[0]?.score ?? 0;
  return scored.filter((x) => x.score === top).map((x) => x.m);
}

