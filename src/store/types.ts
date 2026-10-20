import type { Memory, OpsPlan } from "../memory/index.js";

/** Calorie and macro goals for one person. */
export interface Targets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface Profile {
  id: string;
  name: string;
  timezone: string;
  targets: Targets;
}

export interface MealItem {
  name: string;
  quantity: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** True when the numbers came from a rough guess, not from the assistant. */
  estimated: boolean;
}

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface Meal {
  id: string;
  userId: string;
  mealType: MealType;
  /** Local calendar day in the user's timezone, YYYY-MM-DD. */
  dayKey: string;
  loggedAtMs: number;
  items: MealItem[];
  /** Where the log came from. In the DayZer0 app the meal's source is a free string. */
  source: string;
}

export interface WeightLog {
  id: string;
  userId: string;
  dayKey: string;
  kg: number;
  loggedAtMs: number;
}

/**
 * Today's plan, as the DayZer0 app shows it (daily doc `todays_mission`, plus
 * the optional afternoon nudge). Written by the app's own backend, never here.
 */
export interface TodayPlan {
  dayKey: string;
  focus: { title: string; why: string } | null;
  plan: { eat: string; move: string; recover: string } | null;
  summary: string;
  afternoon: { headline: string; body: string } | null;
}

/**
 * Where data lives. Every method is scoped to one user, so the rest of the
 * code can never read or write across people by accident.
 */
export interface Store {
  getProfile(userId: string): Promise<Profile | null>;
  listUsers(): Promise<Array<{ id: string; name: string }>>;

  listMemories(userId: string): Promise<Memory[]>;
  applyMemoryPlan(userId: string, plan: OpsPlan): Promise<void>;

  /** Saves a meal. If a meal with the same id already exists, nothing changes. */
  addMeal(meal: Meal): Promise<{ meal: Meal; duplicate: boolean }>;
  mealsForDay(userId: string, dayKey: string): Promise<Meal[]>;

  /** One weigh-in per day: a second one the same day replaces the first. */
  upsertWeight(log: WeightLog): Promise<{ log: WeightLog; replaced: boolean }>;
  recentWeights(userId: string, limit: number): Promise<WeightLog[]>;

  /** Today's plan for this user, or null when none has been made yet. Read only. */
  getTodayPlan(userId: string, dayKey: string): Promise<TodayPlan | null>;

  /** Put the demo data back to its starting point. */
  reset(): Promise<void>;
}
