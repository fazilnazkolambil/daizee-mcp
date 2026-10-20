import {
  DAY_MS,
  MEMORY_CATEGORIES,
  type Memory,
  type MemoryCategory,
  type MemoryOp,
  type MemoryOpResult,
  type MemoryView,
} from "./types.js";

/**
 * Daizee's memory policy.
 *
 * Ported from the DayZer0 app's memory store (functions/src/services/memory/
 * memoryStore.js, first added 2026-09-23). The policy is the same; the storage
 * is not: everything here is a pure function over plain objects, and a Store
 * decides where the data lives.
 */

/** Safety-critical facts first, so an allergy never drops behind preferences. */
export const CATEGORY_PRIORITY: Record<string, number> = {
  allergy: 0,
  constraint: 1,
  coach_preference: 2,
  symptom: 3,
  habit: 4,
  food_preference: 5,
  preference: 5, // legacy name, normalised to food_preference on write
  goal: 6,
};

/** How long each kind of fact lives unless the user gave a duration. */
export const MEMORY_TTL_DAYS: Record<string, number> = {
  symptom: 5,
  preference: 90,
  food_preference: 90,
  coach_preference: 180,
  goal: 60,
  constraint: 30,
  allergy: 365,
  habit: 60,
};

export const DEFAULT_TTL_DAYS = 14;
export const MIN_CONFIDENCE = 0.6;
export const MAX_OPS_PER_CALL = 3;
/** A resolved fact is kept one more day, then it is gone. */
export const RESOLVED_GRACE_MS = DAY_MS;
/** Check-ins are offered when a memory ends within this window. */
export const EXPIRE_WINDOW_MS = 72 * 60 * 60 * 1000;
/** Only these kinds of fact are worth asking "still true?" about. */
export const CHECKIN_CATEGORIES: ReadonlySet<string> = new Set([
  "symptom",
  "constraint",
  "habit",
  "goal",
  "allergy",
]);
/**
 * An allergy lasts a year unless it is refreshed. Rather than let the safety net
 * drop silently, ask about it for the last 30 days of its life.
 */
export const ALLERGY_CHECKIN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeCategory(category: string | undefined): string {
  if (category === "preference") return "food_preference";
  return category ?? "";
}

export function isMemoryCategory(category: string): category is MemoryCategory {
  return (MEMORY_CATEGORIES as readonly string[]).includes(category);
}

export function categoryPriority(category: string): number {
  const key = normalizeCategory(category);
  return CATEGORY_PRIORITY[key] ?? CATEGORY_PRIORITY[category] ?? 9;
}

function clampDurationDays(n: number): number {
  return Math.min(Math.max(1, Math.round(n)), 365);
}

/** A given duration wins (1..365 days, rounded); otherwise the category default. */
export function resolveTtlDays(category: string, ttlDays?: number): number {
  const ttl = Number(ttlDays);
  if (Number.isFinite(ttl) && ttl > 0) {
    return clampDurationDays(ttl);
  }
  const cat = normalizeCategory(category);
  return MEMORY_TTL_DAYS[cat] ?? MEMORY_TTL_DAYS[category] ?? DEFAULT_TTL_DAYS;
}

/**
 * Pull a duration from natural language when the assistant omitted durationDays.
 * Conservative: requires an explicit unit (days, weeks, months, year).
 */
export function parseDurationDays(text: string): number | undefined {
  const t = normalizeText(text);
  if (!t) return undefined;

  const dayMatch = t.match(/\b(?:for|next|in)\s+(\d+)\s*days?\b|\b(\d+)\s*day\b|\b(\d+)\s*-\s*day\b/);
  if (dayMatch) {
    const n = Number(dayMatch[1] ?? dayMatch[2] ?? dayMatch[3]);
    if (Number.isFinite(n) && n > 0) return clampDurationDays(n);
  }

  if (/\bthis week\b|\bfor a week\b|\bfor one week\b|\ba week\b/.test(t)) return 7;
  const weekMatch = t.match(/\b(?:for|next|in)\s+(\d+)\s*weeks?\b|\b(\d+)\s*weeks?\b/);
  if (weekMatch) {
    const n = Number(weekMatch[1] ?? weekMatch[2]);
    if (Number.isFinite(n) && n > 0) return clampDurationDays(n * 7);
  }

  if (/\bthis month\b|\bfor a month\b|\bfor one month\b|\ba month\b/.test(t)) return 30;
  const monthMatch = t.match(/\b(?:for|next|in)\s+(\d+)\s*months?\b|\b(\d+)\s*months?\b/);
  if (monthMatch) {
    const n = Number(monthMatch[1] ?? monthMatch[2]);
    if (Number.isFinite(n) && n > 0) return clampDurationDays(n * 30);
  }

  if (/\b(?:for|next|in)\s+a year\b|\ba year\b/.test(t)) return 365;
  const yearMatch = t.match(/\b(?:for|next|in)\s+(\d+)\s*years?\b|\b(\d+)\s*years?\b/);
  if (yearMatch) {
    const n = Number(yearMatch[1] ?? yearMatch[2]);
    if (Number.isFinite(n) && n > 0) return clampDurationDays(n * 365);
  }

  return undefined;
}

export function normalizeText(text: string | undefined): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Two memories are the same fact when their text matches, or one contains the
 * other within the same category ("vegetarian" vs "is vegetarian").
 */
export function isSameFact(
  a: { text: string; category: string },
  b: { text: string; category: string },
): boolean {
  const x = normalizeText(a.text);
  const y = normalizeText(b.text);
  if (!x || !y) return false;
  if (x === y) return true;
  return a.category === b.category && (x.includes(y) || y.includes(x));
}

/** Active, unexpired memories, most important first (then newest first). */
export function selectActive(
  memories: readonly Memory[],
  nowMs: number,
  limit = 10,
): Memory[] {
  return memories
    .filter((m) => m.status === "active" && m.text && m.expiresAtMs > nowMs)
    .sort((a, b) => {
      const pa = categoryPriority(a.category);
      const pb = categoryPriority(b.category);
      if (pa !== pb) return pa - pb;
      return b.createdAtMs - a.createdAtMs;
    })
    .slice(0, limit);
}

export function toView(memory: Memory, nowMs: number): MemoryView {
  return {
    id: memory.id,
    text: memory.text,
    category: memory.category,
    ageDays: Math.max(0, Math.floor((nowMs - memory.createdAtMs) / DAY_MS)),
    expiresInDays: Math.max(0, Math.ceil((memory.expiresAtMs - nowMs) / DAY_MS)),
  };
}

/** Memories ending within 72h that are worth a "still true?" check-in. */
export function pickExpiring(
  memories: readonly Memory[],
  nowMs: number,
  max = 2,
): Memory[] {
  return memories
    .filter(
      (m) =>
        m.status === "active" &&
        m.expiresAtMs > nowMs &&
        m.expiresAtMs <= nowMs + (m.category === "allergy" ? ALLERGY_CHECKIN_WINDOW_MS : EXPIRE_WINDOW_MS) &&
        CHECKIN_CATEGORIES.has(m.category),
    )
    .sort((a, b) => a.expiresAtMs - b.expiresAtMs)
    .slice(0, max);
}

/** The change a store should apply, plus a summary of what happened. */
export interface OpsPlan {
  creates: Memory[];
  /** Patches to existing memories, by id. */
  patches: Array<{ id: string; patch: Partial<Memory> }>;
  result: MemoryOpResult;
}

/**
 * Decide what a list of memory ops does. Pure: nothing is written here.
 *
 *  - add: new durable fact; a repeat of a known fact just refreshes its life.
 *  - update: the fact changed ("now vegan"); rewrites text and refreshes life.
 *  - resolve: the fact is over ("knee is fine now"); kept one more day, then gone.
 *
 * `known` is the user's own active memories. update/resolve only accept ids in
 * `known`, so an invented id (or another user's) can't touch anything.
 */
export function planOps(params: {
  known: readonly Memory[];
  ops: readonly MemoryOp[];
  nowMs: number;
  newId: () => string;
}): OpsPlan {
  const { known, ops, nowMs, newId } = params;
  const result: MemoryOpResult = {
    added: [],
    refreshed: [],
    updated: [],
    resolved: [],
    lowConfidence: 0,
    rejected: 0,
  };
  const creates: Memory[] = [];
  const patches: OpsPlan["patches"] = [];
  const knownById = new Map(known.map((m) => [m.id, m]));

  const list = Array.isArray(ops) ? ops.filter(Boolean) : [];
  const confident = list.filter((op) => (Number(op.confidence) || 0) >= MIN_CONFIDENCE);
  result.lowConfidence = list.length - confident.length;
  const valid = confident.slice(0, MAX_OPS_PER_CALL);
  result.rejected += confident.length - valid.length;

  for (const raw of valid) {
    const op = raw.op ?? "add";
    const text = String(raw.text ?? "").trim();

    if (op === "resolve") {
      if (!raw.id || !knownById.has(raw.id)) {
        result.rejected++;
        continue;
      }
      patches.push({
        id: raw.id,
        patch: {
          status: "resolved",
          resolvedAtMs: nowMs,
          expiresAtMs: nowMs + RESOLVED_GRACE_MS,
        },
      });
      result.resolved.push(raw.id);
      continue;
    }

    if (!text || !raw.category) {
      result.rejected++;
      continue;
    }
    const category = normalizeCategory(raw.category);
    if (!isMemoryCategory(category)) {
      result.rejected++;
      continue;
    }
    const ttlDays = resolveTtlDays(category, raw.ttlDays);
    const expiresAtMs = nowMs + ttlDays * DAY_MS;

    if (op === "update") {
      if (!raw.id || !knownById.has(raw.id)) {
        result.rejected++;
        continue;
      }
      patches.push({
        id: raw.id,
        patch: { text, category, ttlDays, expiresAtMs, updatedAtMs: nowMs },
      });
      result.updated.push(raw.id);
      continue;
    }

    // add: dedupe against what is stored and what this call already added.
    const candidate = { text, category };
    const existing = known.find((m) => isSameFact(m, candidate));
    if (existing) {
      patches.push({
        id: existing.id,
        patch: { ttlDays, expiresAtMs, updatedAtMs: nowMs },
      });
      result.refreshed.push(existing.id);
      continue;
    }
    if (creates.some((m) => isSameFact(m, candidate))) continue;

    const id = newId();
    creates.push({
      id,
      text,
      category,
      confidence: Number(raw.confidence) || MIN_CONFIDENCE,
      status: "active",
      ttlDays,
      createdAtMs: nowMs,
      expiresAtMs,
    });
    result.added.push(id);
  }

  return { creates, patches, result };
}
