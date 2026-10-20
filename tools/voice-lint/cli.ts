/**
 * Voice lint: plays a scripted story through every tool on the fictional demo
 * users and checks each `spoken` reply against the rules a voice assistant
 * needs (non-empty, at most MAX_SPOKEN_WORDS words, no markdown or emoji,
 * ends like a sentence, and a weigh-in never says the number).
 *
 *   npm run lint:voice
 *
 * Exits 1 if any reply breaks a rule. No network, no keys.
 */
import { buildApp } from "../../src/server/main.js";
import { MAX_SPOKEN_WORDS } from "../../src/server/spoken.js";

type Step = { tool: string; user: string; run: () => Promise<{ spoken?: string }>; forbid?: RegExp };

const { service: s, clock } = buildApp({ demo: true });

const steps: Step[] = [
  { tool: "get_day_progress", user: "maya", run: () => s.dayProgress("maya") },
  { tool: "get_day_progress", user: "sam", run: () => s.dayProgress("sam") },
  { tool: "get_today_plan", user: "maya", run: () => s.todayPlan("maya") },
  { tool: "get_today_plan", user: "sam", run: () => s.todayPlan("sam") },
  { tool: "recall_what_you_know", user: "maya", run: () => s.recall("maya") },
  { tool: "recall_what_you_know", user: "sam", run: () => s.recall("sam") },
  { tool: "remember_about_user", user: "sam", run: () => s.remember("sam", { category: "allergy", text: "allergic to peanuts" }) },
  { tool: "remember_about_user", user: "sam", run: () => s.remember("sam", { category: "allergy", text: "allergic to peanuts" }) },
  { tool: "remember_about_user", user: "sam", run: () => s.remember("sam", { category: "allergy", text: "allergic to kiwi" }) },
  { tool: "remember_about_user", user: "maya", run: () => s.remember("maya", { category: "goal", text: "travelling to Kerala for a week", durationDays: 7 }) },
  { tool: "recall_what_you_know", user: "maya", run: () => s.recall("maya") },
  { tool: "log_meal", user: "sam", run: () => s.logMeal("sam", { mealType: "dinner", items: [{ name: "pad thai" }] }) },
  { tool: "log_meal", user: "sam", run: () => s.logMeal("sam", { mealType: "breakfast", items: [{ name: "idli", quantity: 2 }, { name: "sambar" }] }) },
  { tool: "log_meal", user: "sam", run: () => s.logMeal("sam", { mealType: "snack", items: [{ name: "a very unusual homemade snack" }] }) },
  { tool: "log_weight", user: "maya", run: () => s.logWeight("maya", { kg: 61.5 }), forbid: /61[.,]5|\bkilo|\bkg\b/i },
  { tool: "log_weight", user: "maya", run: () => s.logWeight("maya", { kg: 75 }), forbid: /\b75\b|\bkilo|\bkg\b/i },
  { tool: "resolve_memory", user: "maya", run: () => s.resolve("maya", { query: "knee" }) },
  { tool: "resolve_memory", user: "maya", run: () => s.resolve("maya", { query: "knee", confirm: true }) },
  { tool: "resolve_memory", user: "maya", run: () => s.resolve("maya", { query: "nothing like this" }) },
  { tool: "resolve_memory", user: "sam", run: () => s.resolve("sam", { confirm: true }) },
  {
    tool: "get_day_progress",
    user: "maya",
    run: async () => {
      clock.advanceDays(1); // a day later: notes near expiry raise check-ins
      return s.dayProgress("maya");
    },
  },
];

function problems(spoken: string | undefined, forbid?: RegExp): string[] {
  const out: string[] = [];
  const text = (spoken ?? "").trim();
  if (!text) return ["empty"];
  const words = text.split(/\s+/).length;
  if (words > MAX_SPOKEN_WORDS) out.push(`${words} words (max ${MAX_SPOKEN_WORDS})`);
  if (/[*_`#|>~]/.test(text)) out.push("markdown characters");
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)) out.push("emoji");
  if (!/[.?!]$/.test(text)) out.push("does not end like a sentence");
  if (forbid?.test(text)) out.push(`says something it must not (${forbid})`);
  return out;
}

let failed = 0;
for (const step of steps) {
  let spoken: string | undefined;
  let issues: string[];
  try {
    spoken = (await step.run()).spoken;
    issues = problems(spoken, step.forbid);
  } catch (err) {
    issues = [`threw: ${err instanceof Error ? err.message : String(err)}`];
  }
  if (issues.length) failed++;
  console.log(`${issues.length ? "FAIL" : "ok  "}  ${step.tool.padEnd(21)} ${step.user.padEnd(5)} ${issues.length ? issues.join("; ") + "  | " : ""}${spoken ?? ""}`);
}
console.log(`\n${steps.length - failed}/${steps.length} spoken replies pass the voice rules.`);
process.exit(failed ? 1 : 0);
