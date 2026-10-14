/**
 * Memory types. This folder (src/memory) is deliberately import-free from the
 * rest of the project: it is pure rules, so it can be reused anywhere.
 */

export const MEMORY_CATEGORIES = [
  "allergy",
  "constraint",
  "coach_preference",
  "symptom",
  "habit",
  "food_preference",
  "goal",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export type MemoryStatus = "active" | "resolved";

export interface Memory {
  id: string;
  text: string;
  category: MemoryCategory;
  confidence: number;
  status: MemoryStatus;
  ttlDays: number;
  createdAtMs: number;
  updatedAtMs?: number;
  resolvedAtMs?: number;
  expiresAtMs: number;
}

/** What the assistant asks the memory to do. `add` is the default. */
export interface MemoryOp {
  op?: "add" | "update" | "resolve";
  id?: string;
  text?: string;
  category?: string;
  ttlDays?: number;
  confidence?: number;
}

export interface MemoryOpResult {
  added: string[];
  refreshed: string[];
  updated: string[];
  resolved: string[];
  /** Ops dropped because confidence was below the gate (ask the user to confirm). */
  lowConfidence: number;
  /** Ops dropped for any other reason (unknown id, empty text, over the cap). */
  rejected: number;
}

/** A memory as shown to the assistant: small and id-addressable. */
export interface MemoryView {
  id: string;
  text: string;
  category: MemoryCategory;
  ageDays: number;
  expiresInDays: number;
}

/** Time source. Injectable so a demo can "advance time" without waiting. */
export interface Clock {
  now(): number;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
