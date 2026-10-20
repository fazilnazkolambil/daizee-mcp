import { randomUUID } from "node:crypto";
import { DAY_MS, type Clock, type Memory, type OpsPlan } from "../memory/index.js";
import { dayKeyFor } from "./dayKey.js";
import type { Meal, MealItem, MealType, Profile, Store, TodayPlan, WeightLog } from "./types.js";

/** The shape of seed/*.json. Times are relative so the demo is always "now". */
export interface SeedUser {
  id: string;
  name: string;
  timezone: string;
  targets: Profile["targets"];
  memories: Array<{
    text: string;
    category: Memory["category"];
    ageDays: number;
    ttlDays: number;
  }>;
  meals: Array<{
    dayOffset: number;
    mealType: MealType;
    items: Array<Omit<MealItem, "estimated"> & { estimated?: boolean }>;
  }>;
  weights: Array<{ daysAgo: number; kg: number }>;
  /** Stands in for the plan the app's midnight job writes each day. */
  todayPlan?: Omit<TodayPlan, "dayKey" | "afternoon"> & { afternoon?: TodayPlan["afternoon"] };
}

interface UserData {
  profile: Profile;
  memories: Map<string, Memory>;
  meals: Map<string, Meal>;
  weights: Map<string, WeightLog>; // keyed by dayKey
}

/**
 * The default store: everything lives in memory, seeded from fictional demo
 * users. No accounts, no network, nothing to set up.
 */
export class InMemoryStore implements Store {
  private users = new Map<string, UserData>();

  constructor(
    private readonly seeds: readonly SeedUser[],
    private readonly clock: Clock,
  ) {
    this.load();
  }

  private load(): void {
    this.users.clear();
    const now = this.clock.now();
    for (const seed of this.seeds) {
      const profile: Profile = {
        id: seed.id,
        name: seed.name,
        timezone: seed.timezone,
        targets: { ...seed.targets },
      };
      const data: UserData = {
        profile,
        memories: new Map(),
        meals: new Map(),
        weights: new Map(),
      };

      seed.memories.forEach((m, i) => {
        const createdAtMs = now - m.ageDays * DAY_MS;
        const id = `${seed.id}-mem-${i + 1}`;
        data.memories.set(id, {
          id,
          text: m.text,
          category: m.category,
          confidence: 0.9,
          status: "active",
          ttlDays: m.ttlDays,
          createdAtMs,
          expiresAtMs: createdAtMs + m.ttlDays * DAY_MS,
        });
      });

      seed.meals.forEach((m, i) => {
        const loggedAtMs = now + m.dayOffset * DAY_MS;
        const id = `${seed.id}-meal-${i + 1}`;
        data.meals.set(id, {
          id,
          userId: seed.id,
          mealType: m.mealType,
          dayKey: dayKeyFor(loggedAtMs, seed.timezone),
          loggedAtMs,
          items: m.items.map((it) => ({ ...it, estimated: it.estimated ?? false })),
          source: "seed",
        });
      });

      for (const w of seed.weights) {
        const loggedAtMs = now - w.daysAgo * DAY_MS;
        const dayKey = dayKeyFor(loggedAtMs, seed.timezone);
        data.weights.set(dayKey, {
          id: `${seed.id}-w-${dayKey}`,
          userId: seed.id,
          dayKey,
          kg: w.kg,
          loggedAtMs,
        });
      }

      this.users.set(seed.id, data);
    }
  }

  private user(userId: string): UserData {
    const data = this.users.get(userId);
    if (!data) throw new Error(`Unknown user: ${userId}`);
    return data;
  }

  async getProfile(userId: string): Promise<Profile | null> {
    return this.users.get(userId)?.profile ?? null;
  }

  async listUsers(): Promise<Array<{ id: string; name: string }>> {
    return [...this.users.values()].map((u) => ({ id: u.profile.id, name: u.profile.name }));
  }

  async listMemories(userId: string): Promise<Memory[]> {
    return [...this.user(userId).memories.values()].map((m) => ({ ...m }));
  }

  async applyMemoryPlan(userId: string, plan: OpsPlan): Promise<void> {
    const data = this.user(userId);
    for (const created of plan.creates) data.memories.set(created.id, { ...created });
    for (const { id, patch } of plan.patches) {
      const current = data.memories.get(id);
      if (current) data.memories.set(id, { ...current, ...patch });
    }
  }

  async addMeal(meal: Meal): Promise<{ meal: Meal; duplicate: boolean }> {
    const data = this.user(meal.userId);
    const existing = data.meals.get(meal.id);
    if (existing) return { meal: existing, duplicate: true };
    data.meals.set(meal.id, meal);
    return { meal, duplicate: false };
  }

  async mealsForDay(userId: string, dayKey: string): Promise<Meal[]> {
    return [...this.user(userId).meals.values()]
      .filter((m) => m.dayKey === dayKey)
      .sort((a, b) => a.loggedAtMs - b.loggedAtMs);
  }

  async upsertWeight(log: WeightLog): Promise<{ log: WeightLog; replaced: boolean }> {
    const data = this.user(log.userId);
    const replaced = data.weights.has(log.dayKey);
    data.weights.set(log.dayKey, log);
    return { log, replaced };
  }

  async recentWeights(userId: string, limit: number): Promise<WeightLog[]> {
    return [...this.user(userId).weights.values()]
      .sort((a, b) => b.loggedAtMs - a.loggedAtMs)
      .slice(0, limit);
  }

  async getTodayPlan(userId: string, dayKey: string): Promise<TodayPlan | null> {
    const seed = this.seeds.find((s) => s.id === userId);
    if (!seed) throw new Error(`Unknown user: ${userId}`);
    // The seeded plan plays the role of "the plan made at midnight", so every day has one.
    const plan = seed.todayPlan;
    return plan ? { dayKey, ...structuredClone(plan), afternoon: plan.afternoon ?? null } : null;
  }

  async reset(): Promise<void> {
    this.load();
  }
}

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
