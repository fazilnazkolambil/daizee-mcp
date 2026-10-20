import { isMemoryCategory, type Clock, type Memory, type OpsPlan } from "../memory/index.js";
import { dayKeyFor } from "./dayKey.js";
import { allowlistGuard, type DocData, type DocDb } from "./docDb.js";
import type { Meal, MealItem, MealType, Profile, Store, Targets, TodayPlan, WeightLog } from "./types.js";

/**
 * The real DayZer0 app's data, in its own Firestore shapes, so the app and its
 * Cloud Functions treat a voice log exactly like one made in the app:
 *
 *   users/{uid}                     profile: name, timezone, targetCalories, proteinGoal, carbsGoal, fatGoal
 *   users/{uid}/meals/{mealId}      a meal; the app's onMealWritten trigger rebuilds daily/{date}.meals
 *                                   and posts a "Breakfast logged" card in that day's Daizee chat
 *   users/{uid}/weightLogs/weight_{date}   one weigh-in a day; onWeightLogWritten updates the profile
 *   users/{uid}/memories/{id}       Daizee's notes (same rules as src/memory)
 *   users/{uid}/daily/{date}        read only here: todays_mission and afternoon
 *
 * This service never writes daily docs: totals are the app backend's job.
 *
 * Users are reached ONLY through an allowlist that maps a short name (the
 * x-daizee-user header) to a Firebase uid. Anything else is refused, and every
 * path is checked again by allowlistGuard.
 */

const DEFAULT_TIMEZONE = "Asia/Kolkata"; // the app's own default (APP.TIMEZONE)
const SOURCE = "alexa";
const MEMORY_POOL = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

const UPPER_MEAL: Record<MealType, string> = { breakfast: "BREAKFAST", lunch: "LUNCH", dinner: "DINNER", snack: "SNACK" };

export class FirestoreStore implements Store {
  private readonly db: DocDb;
  private readonly uids: ReadonlyMap<string, string>;

  /**
   * @param users short name -> Firebase uid. The short name is what the
   *   assistant sends; the uid never leaves this class.
   */
  constructor(db: DocDb, users: ReadonlyMap<string, string>, private readonly clock: Clock) {
    if (users.size === 0) throw new Error("FirestoreStore needs at least one allowed user");
    this.uids = new Map(users);
    this.db = allowlistGuard(db, this.uids.values());
  }

  private uid(userId: string): string {
    const uid = this.uids.get(userId);
    if (!uid) throw new Error(`Unknown user: ${userId}`);
    return uid;
  }

  private async userDoc(userId: string): Promise<DocData | null> {
    if (!this.uids.has(userId)) return null;
    return this.db.get(`users/${this.uid(userId)}`);
  }

  private async timeZone(userId: string): Promise<string> {
    const doc = await this.userDoc(userId);
    return doc ? timeZoneOf(doc) : DEFAULT_TIMEZONE;
  }

  // ── Profile ───────────────────────────────────────────────────────────

  async getProfile(userId: string): Promise<Profile | null> {
    const doc = await this.userDoc(userId);
    if (!doc) return null;
    const timezone = timeZoneOf(doc);
    let targets: Targets = {
      calories: num(doc.targetCalories),
      protein: num(doc.proteinGoal),
      carbs: num(doc.carbsGoal),
      fat: num(doc.fatGoal),
    };
    if (targets.calories <= 0) {
      // Not onboarded yet: fall back to whatever today's daily doc says.
      const daily = await this.db.get(`users/${this.uid(userId)}/daily/${dayKeyFor(this.clock.now(), timezone)}`);
      const t = (daily?.targets ?? {}) as DocData;
      targets = { calories: num(t.calories), protein: num(t.protein), carbs: num(t.carbs), fat: num(t.fat) };
    }
    return { id: userId, name: str(doc.name) || userId, timezone, targets };
  }

  async listUsers(): Promise<Array<{ id: string; name: string }>> {
    const out: Array<{ id: string; name: string }> = [];
    for (const id of this.uids.keys()) {
      const profile = await this.getProfile(id);
      if (profile) out.push({ id, name: profile.name });
    }
    return out;
  }

  // ── Memories ──────────────────────────────────────────────────────────

  async listMemories(userId: string): Promise<Memory[]> {
    // Only active notes are ever used. One equality filter needs no composite index.
    const docs = await this.db.query(`users/${this.uid(userId)}/memories`, {
      where: [["status", "==", "active"]],
      limit: MEMORY_POOL,
    });
    return docs.map(({ id, data }) => toMemory(id, data)).filter((m): m is Memory => m !== null);
  }

  async applyMemoryPlan(userId: string, plan: OpsPlan): Promise<void> {
    const base = `users/${this.uid(userId)}/memories`;
    for (const m of plan.creates) {
      // Same fields as the app's memoryStore.applyMemoryOps, so its jobs read these too.
      await this.db.set(`${base}/${m.id}`, {
        text: m.text,
        category: m.category,
        confidence: m.confidence,
        status: m.status,
        sourceChatId: null,
        sourceMessageId: null,
        sourceTurnId: null,
        source: SOURCE,
        ttlDays: m.ttlDays,
        expiresAtMs: m.expiresAtMs,
        expiresAt: new Date(m.expiresAtMs),
        createdAt: new Date(m.createdAtMs),
        createdAtMs: m.createdAtMs,
      });
    }
    for (const { id, patch } of plan.patches) {
      const fields: DocData = {};
      for (const key of ["text", "category", "confidence", "status", "ttlDays", "expiresAtMs", "updatedAtMs", "resolvedAtMs"] as const) {
        if (patch[key] !== undefined) fields[key] = patch[key];
      }
      if (patch.expiresAtMs !== undefined) fields.expiresAt = new Date(patch.expiresAtMs);
      await this.db.update(`${base}/${id}`, fields);
    }
  }

  // ── Meals ─────────────────────────────────────────────────────────────

  async addMeal(meal: Meal): Promise<{ meal: Meal; duplicate: boolean }> {
    const uid = this.uid(meal.userId);
    const path = `users/${uid}/meals/${meal.id}`;
    const created = await this.db.create(path, toMealDoc(meal));
    if (created) return { meal, duplicate: false };
    const existing = await this.db.get(path);
    const timezone = await this.timeZone(meal.userId);
    return { meal: existing ? toMeal(meal.id, meal.userId, existing, timezone) : meal, duplicate: true };
  }

  async mealsForDay(userId: string, dayKey: string): Promise<Meal[]> {
    const timezone = await this.timeZone(userId);
    // A window wide enough for any timezone, then keep exactly that local day.
    const midnightUtc = Date.parse(`${dayKey}T00:00:00Z`);
    const docs = await this.db.query(`users/${this.uid(userId)}/meals`, {
      where: [
        ["createdAt", ">=", midnightUtc - 15 * 60 * 60 * 1000],
        ["createdAt", "<", midnightUtc + DAY_MS + 15 * 60 * 60 * 1000],
      ],
      orderBy: { field: "createdAt", direction: "asc" },
      limit: 200,
    });
    return docs
      .map(({ id, data }) => toMeal(id, userId, data, timezone))
      .filter((m) => m.dayKey === dayKey);
  }

  // ── Weight ────────────────────────────────────────────────────────────

  async upsertWeight(log: WeightLog): Promise<{ log: WeightLog; replaced: boolean }> {
    // Same id the app uses (weight_{date}), so there is still one weigh-in a day.
    const path = `users/${this.uid(log.userId)}/weightLogs/weight_${log.dayKey}`;
    const replaced = (await this.db.get(path)) !== null;
    await this.db.set(path, {
      weightKg: Math.round(log.kg * 10) / 10,
      recordedAt: log.loggedAtMs,
      source: SOURCE,
      // The app's daily weight quota was not claimed, so deleting this must not refund one.
      quotaClaimed: false,
    });
    return { log: { ...log, id: `weight_${log.dayKey}` }, replaced };
  }

  async recentWeights(userId: string, limit: number): Promise<WeightLog[]> {
    const timezone = await this.timeZone(userId);
    const docs = await this.db.query(`users/${this.uid(userId)}/weightLogs`, {
      orderBy: { field: "recordedAt", direction: "desc" },
      limit,
    });
    return docs
      .map(({ id, data }) => ({
        id,
        userId,
        dayKey: dayKeyFor(num(data.recordedAt), timezone),
        kg: num(data.weightKg),
        loggedAtMs: num(data.recordedAt),
      }))
      .filter((w) => w.kg > 0);
  }

  // ── Today's plan ──────────────────────────────────────────────────────

  async getTodayPlan(userId: string, dayKey: string): Promise<TodayPlan | null> {
    const daily = await this.db.get(`users/${this.uid(userId)}/daily/${dayKey}`);
    if (!daily) return null;
    const mission = (daily.todays_mission ?? null) as DocData | null;
    const afternoonDoc = (daily.afternoon ?? null) as DocData | null;
    const focusDoc = (mission?.focus ?? null) as DocData | null;
    const planDoc = (mission?.plan ?? null) as DocData | null;

    const focus = focusDoc && str(focusDoc.title) ? { title: str(focusDoc.title), why: str(focusDoc.why) } : null;
    const plan = planDoc && (str(planDoc.eat) || str(planDoc.move) || str(planDoc.recover))
      ? { eat: str(planDoc.eat), move: str(planDoc.move), recover: str(planDoc.recover) }
      : null;
    // Older docs have {headline, body, summary} instead of a plan.
    const summary = str(mission?.summary) || str(mission?.body);
    const afternoon = afternoonDoc && str(afternoonDoc.headline)
      ? { headline: str(afternoonDoc.headline), body: str(afternoonDoc.body) }
      : null;
    if (!focus && !plan && !summary && !afternoon) return null;
    return { dayKey, focus, plan, summary, afternoon };
  }

  /** Real data is never wiped. The demo's reset control is turned off in this mode. */
  async reset(): Promise<void> {
    throw new Error("reset is not available for the real app's data");
  }
}

// ── Shapes ────────────────────────────────────────────────────────────────

/** The stored meal, as the app's MealModel.fromJson and the meal triggers read it. */
export function toMealDoc(meal: Meal): DocData {
  const foods = meal.items.map((it, i) => {
    const food: DocData = {
      id: `food_${i}`,
      name: it.name,
      category: "other",
      quantity: it.quantity,
      unit: "serving",
      step: 1,
      calories: it.calories,
      protein: it.protein,
      carbs: it.carbs,
      fat: it.fat,
      confidence: it.estimated ? 0.5 : 0.9,
    };
    // Extra field, ignored by the app: lets a read-back keep the "guessed" flag.
    if (it.estimated) food.estimated = true;
    return food;
  });
  const sum = (k: "calories" | "protein" | "carbs" | "fat") =>
    Math.round(meal.items.reduce((acc, it) => acc + it[k], 0) * 10) / 10;
  return {
    id: meal.id,
    mealType: UPPER_MEAL[meal.mealType],
    foods,
    photoUrls: [],
    photoPaths: [],
    totalCalories: sum("calories"),
    protein: sum("protein"),
    carbs: sum("carbs"),
    fat: sum("fat"),
    fiber: 0,
    confidence: meal.items.some((i) => i.estimated) ? 0.5 : 0.9,
    editedByUser: false,
    createdAt: meal.loggedAtMs, // epoch ms: the triggers' day queries depend on this
    source: SOURCE,
  };
}

function toMeal(id: string, userId: string, data: DocData, timezone: string): Meal {
  const createdAt = num(data.createdAt);
  const type = str(data.mealType).toLowerCase();
  const items: MealItem[] = (Array.isArray(data.foods) ? (data.foods as DocData[]) : []).map((f) => ({
    name: str(f.name) || "food",
    quantity: num(f.quantity) || 1,
    calories: num(f.calories),
    protein: num(f.protein),
    carbs: num(f.carbs),
    fat: num(f.fat),
    estimated: f.estimated === true,
  }));
  return {
    id,
    userId,
    mealType: (["breakfast", "lunch", "dinner", "snack"].includes(type) ? type : "snack") as MealType,
    dayKey: dayKeyFor(createdAt, timezone),
    loggedAtMs: createdAt,
    items,
    source: str(data.source) || "app",
  };
}

function toMemory(id: string, d: DocData): Memory | null {
  const raw = str(d.category);
  const category = raw === "preference" ? "food_preference" : raw;
  if (!isMemoryCategory(category) || !str(d.text)) return null;
  const createdAtMs = num(d.createdAtMs) || (d.createdAt instanceof Date ? d.createdAt.getTime() : 0);
  const memory: Memory = {
    id,
    text: str(d.text),
    category,
    confidence: num(d.confidence) || 0.9,
    status: d.status === "resolved" ? "resolved" : "active",
    ttlDays: num(d.ttlDays),
    createdAtMs,
    expiresAtMs: num(d.expiresAtMs) || Number.MAX_SAFE_INTEGER,
  };
  if (d.updatedAtMs != null) memory.updatedAtMs = num(d.updatedAtMs);
  if (d.resolvedAtMs != null) memory.resolvedAtMs = num(d.resolvedAtMs);
  return memory;
}

function timeZoneOf(doc: DocData): string {
  return str(doc.timezone) || str(doc.timeZone) || DEFAULT_TIMEZONE;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
