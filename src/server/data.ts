import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SeedUser } from "../store/inMemoryStore.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// From src/server the data is at ../../seed; from the packaged function (lib/) it is at ../seed.
const SEED_DIR = [resolve(HERE, "../../seed"), resolve(HERE, "../seed")].find((dir) => existsSync(resolve(dir, "maya.json"))) ?? resolve(HERE, "../../seed");

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(SEED_DIR, name), "utf8")) as T;
}

export interface Dish {
  name: string;
  aliases: string[];
  serving: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  contains: string[];
}

export interface AllergenRule {
  key: string;
  label: string;
  /** 'allergen' reads "may contain X"; 'diet' reads "may not fit X". */
  kind?: "allergen" | "diet";
  memoryTerms: string[];
  foodTerms: string[];
  containsTags: string[];
}

export interface SeedData {
  users: SeedUser[];
  dishes: Dish[];
  rules: AllergenRule[];
}

/** Loads the fictional demo users, the food table and the allergy rules. */
export function loadSeedData(): SeedData {
  return {
    users: [readJson<SeedUser>("maya.json"), readJson<SeedUser>("sam.json")],
    dishes: readJson<{ dishes: Dish[] }>("dishes.json").dishes,
    rules: readJson<{ rules: AllergenRule[] }>("allergens.json").rules,
  };
}
