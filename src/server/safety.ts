import { normalizeText, type Memory } from "../memory/index.js";
import type { MealItem } from "../store/types.js";
import type { AllergenRule, Dish } from "./data.js";

/**
 * The safety check: when a logged meal conflicts with an allergy or diet the
 * user told us about, say so. It is INFORMATIONAL. It matches words, so it can
 * miss things, and it is never medical advice.
 */

export interface SafetyFlag {
  memoryId: string;
  memoryText: string;
  category: string;
  item: string;
  reason: string;
  severity: "warning";
}

/** Only these kinds of fact can raise a safety flag. */
const SAFETY_CATEGORIES: ReadonlySet<string> = new Set(["allergy", "constraint"]);

function stem(word: string): string {
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

export function tokens(text: string): string[] {
  return normalizeText(text).split(" ").filter(Boolean).map(stem);
}

function containsPhrase(haystack: string[], phrase: string[]): boolean {
  if (!phrase.length || phrase.length > haystack.length) return false;
  for (let i = 0; i <= haystack.length - phrase.length; i++) {
    if (phrase.every((w, j) => haystack[i + j] === w)) return true;
  }
  return false;
}

function anyTerm(haystack: string[], terms: readonly string[]): boolean {
  return terms.some((t) => containsPhrase(haystack, tokens(t)));
}

/** Longest dish name or alias found inside the item text, if any. */
export function matchDish(itemName: string, dishes: readonly Dish[]): Dish | undefined {
  const itemTokens = tokens(itemName);
  let best: { dish: Dish; len: number } | undefined;
  for (const dish of dishes) {
    for (const label of [dish.name, ...dish.aliases]) {
      const labelTokens = tokens(label);
      if (containsPhrase(itemTokens, labelTokens) && (!best || labelTokens.length > best.len)) {
        best = { dish, len: labelTokens.length };
      }
    }
  }
  return best?.dish;
}

export function checkMeal(params: {
  items: readonly MealItem[];
  memories: readonly Memory[];
  rules: readonly AllergenRule[];
  dishes: readonly Dish[];
}): SafetyFlag[] {
  const { items, memories, rules, dishes } = params;
  const flags: SafetyFlag[] = [];
  const seen = new Set<string>();

  for (const memory of memories) {
    if (!SAFETY_CATEGORIES.has(memory.category)) continue;
    const memoryTokens = tokens(memory.text);
    const active = rules.filter((r) => anyTerm(memoryTokens, r.memoryTerms));
    if (!active.length) continue;

    for (const item of items) {
      const itemTokens = tokens(item.name);
      const dish = matchDish(item.name, dishes);
      for (const rule of active) {
        const hit =
          anyTerm(itemTokens, rule.foodTerms) ||
          (dish !== undefined && dish.contains.some((tag) => rule.containsTags.includes(tag)));
        if (!hit) continue;
        const dedupe = `${memory.id}|${item.name}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        flags.push({
          memoryId: memory.id,
          memoryText: memory.text,
          category: memory.category,
          item: item.name,
          reason: rule.kind === "diet" ? `${item.name} may not fit ${rule.label}` : `${item.name} may contain ${rule.label}`,
          severity: "warning",
        });
      }
    }
  }
  return flags;
}

/**
 * Can meals be checked against this note automatically? Only allergy and diet
 * notes matter, and only those that match a rule in the keyword table. Anything
 * else is saved but NOT checked, and the user should be told so.
 */
export function mealCheckCoverage(
  memory: { text: string; category: string },
  rules: readonly AllergenRule[],
): "covered" | "not_covered" | "not_applicable" {
  if (!SAFETY_CATEGORIES.has(memory.category)) return "not_applicable";
  const memoryTokens = tokens(memory.text);
  return rules.some((r) => anyTerm(memoryTokens, r.memoryTerms)) ? "covered" : "not_covered";
}
