import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MEMORY_CATEGORIES } from "../memory/index.js";
import { DaizeeService, UserNotFoundError } from "./service.js";

/**
 * The seven actions Alexa+ (or any MCP assistant) can call.
 *
 * Design rules, taken from Amazon's public Alexa+ add-on guidance:
 *  - one action per customer intent, with clear descriptions;
 *  - every action returns a short plain-text sentence AND structured data;
 *  - no free-form "chat" action and no language model in here;
 *  - writes are idempotent, and anything destructive asks for confirmation.
 */

const targets = z.object({
  calories: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
});

const memoryView = z.object({
  id: z.string(),
  text: z.string(),
  category: z.enum(MEMORY_CATEGORIES),
  ageDays: z.number(),
  expiresInDays: z.number(),
});

const safetyFlag = z.object({
  memoryId: z.string(),
  memoryText: z.string(),
  category: z.string(),
  item: z.string(),
  reason: z.string(),
  severity: z.literal("warning"),
});

const spokenField = z.string().describe("A short plain-text reply the assistant can say aloud.");

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(out: { spoken: string } & Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: out.spoken }], structuredContent: out };
}

function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function run(fn: () => Promise<{ spoken: string } & Record<string, unknown>>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    if (err instanceof UserNotFoundError) return fail(err.message);
    return fail("Something went wrong on my side. Please try again.");
  }
}

export function registerTools(server: McpServer, service: DaizeeService, userId: string): void {
  server.registerTool(
    "get_day_progress",
    {
      title: "How am I doing today",
      description:
        "Use when the user asks how their day is going, what they have eaten, how many calories or how much protein is left, or opens the add-on. " +
        "Returns calories and macros eaten vs goal, what remains, and any check-ins: notes about the user (like a sore knee) that are about to expire. " +
        "For what to focus on or what the plan is today, use get_today_plan instead.",
      outputSchema: {
        dayKey: z.string(),
        eaten: targets,
        targets,
        remaining: targets,
        mealsLogged: z.number(),
        checkIns: z.array(
          z.object({ memoryId: z.string(), text: z.string(), expiresInDays: z.number(), question: z.string() }),
        ),
        spoken: spokenField,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    () => run(() => service.dayProgress(userId)),
  );

  server.registerTool(
    "get_today_plan",
    {
      title: "What should I focus on today",
      description:
        "Use when the user asks what to focus on today, what today's plan is, or what they should eat, do or work on today " +
        "(for example 'what should I focus on today?', 'what's my plan?'). Read only, logs nothing. " +
        "Returns the day's one focus with its reason, three short steps (eat, move, recover) made by the Daizee app, " +
        "and the afternoon nudge if there is one. For calories eaten or left, use get_day_progress instead.",
      outputSchema: {
        dayKey: z.string(),
        hasPlan: z.boolean(),
        focus: z.object({ title: z.string(), why: z.string() }).nullable(),
        plan: z.object({ eat: z.string(), move: z.string(), recover: z.string() }).nullable(),
        summary: z.string(),
        afternoon: z.object({ headline: z.string(), body: z.string() }).nullable(),
        spoken: spokenField,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    () => run(() => service.todayPlan(userId)),
  );

  server.registerTool(
    "log_meal",
    {
      title: "Log a meal",
      description:
        "Use when the user says they ate or drank something (for example 'I had two idlis and sambar for breakfast'). " +
        "Pass each food as an item. If you know the calories or macros, pass them as TOTALS for that item; otherwise leave them out and the service estimates. " +
        "Returns today's totals and what remains, and safetyFlags if the meal conflicts with an allergy or diet the user told us about. "
        + "The check matches words against a built-in list of common allergens and diets, so an empty safetyFlags list is NOT a clearance. " +
        "Logging the same meal twice in a day does not double count.",
      inputSchema: {
        mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).describe("Which meal this was."),
        items: z
          .array(
            z.object({
              name: z.string().min(1).max(60).describe("The food, for example 'masala dosa'."),
              quantity: z.number().positive().max(20).optional().describe("How many servings. Default 1."),
              calories: z.number().min(0).max(5000).optional().describe("Total calories for this item, if known."),
              protein: z.number().min(0).max(500).optional().describe("Total grams of protein, if known."),
              carbs: z.number().min(0).max(1000).optional().describe("Total grams of carbs, if known."),
              fat: z.number().min(0).max(500).optional().describe("Total grams of fat, if known."),
            }),
          )
          .min(1)
          .max(8),
        idempotencyKey: z.string().max(64).optional().describe("Optional. Repeating the same key never logs twice."),
      },
      outputSchema: {
        mealId: z.string(),
        duplicate: z.boolean(),
        mealType: z.string(),
        mealTotals: targets,
        totalsToday: targets,
        remaining: targets,
        estimatedItems: z.array(z.string()),
        safetyFlags: z.array(safetyFlag),
        spoken: spokenField,
      },
      annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    (args) => run(() => service.logMeal(userId, args)),
  );

  server.registerTool(
    "remember_about_user",
    {
      title: "Remember something about me",
      description:
        "Use when the user shares a lasting fact about themselves: an allergy, a diet, an injury or symptom, a habit, a food they like, or how they want to be coached " +
        "(for example 'I'm allergic to peanuts', 'my left knee is sore this week'). Facts expire on purpose: an allergy lasts about a year, a sore knee about 5 days, " +
        "unless the user gives a duration. Saying the same thing again just keeps it fresh.",
      inputSchema: {
        category: z.enum(MEMORY_CATEGORIES).describe("allergy, constraint (a diet or rule), symptom, habit, food_preference, coach_preference or goal."),
        text: z.string().min(3).max(120).describe("The fact, in a few words."),
        durationDays: z.number().int().min(1).max(365).optional().describe("How long it stays true, if the user said."),
        confidence: z.number().min(0).max(1).optional().describe("How sure you are the user meant it. Below 0.6 asks the user to confirm."),
      },
      outputSchema: {
        outcome: z.enum(["saved", "refreshed", "needs_confirmation", "not_saved"]),
        memory: memoryView.nullable(),
        mealCheck: z.enum(["covered", "not_covered", "not_applicable"]).describe("Whether future meals can be checked against this note automatically."),
        spoken: spokenField,
      },
      annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    (args) => run(() => service.remember(userId, args)),
  );

  server.registerTool(
    "recall_what_you_know",
    {
      title: "What do you know about me",
      description:
        "Use when the user asks what you know or remember about them, or before giving advice that depends on their allergies, injuries or preferences. " +
        "Returns at most 5 active notes, most important first (allergies always come first), each with how many days it has left.",
      outputSchema: {
        memories: z.array(memoryView),
        spoken: spokenField,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    () => run(() => service.recall(userId)),
  );

  server.registerTool(
    "resolve_memory",
    {
      title: "Forget or finish a note",
      description:
        "Use when something the user told us is no longer true ('my knee is better') or they ask to forget a note. " +
        "Two steps, enforced by the service: first call without confirm to find the note and ask the user; only after the user says yes, call again with confirm true (a confirm without that earlier ask is ignored). " +
        "Pass memoryId if you have it, or a short query such as 'knee'.",
      inputSchema: {
        memoryId: z.string().max(64).optional(),
        query: z.string().min(2).max(60).optional().describe("A word or two that identifies the note, for example 'knee'."),
        confirm: z.boolean().optional().describe("Set true only after the user has said yes."),
      },
      outputSchema: {
        outcome: z.enum(["not_found", "ambiguous", "needs_confirmation", "resolved"]),
        candidates: z.array(memoryView),
        spoken: spokenField,
      },
      annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: false },
    },
    (args) => run(() => service.resolve(userId, args)),
  );

  server.registerTool(
    "log_weight",
    {
      title: "Log my weight",
      description:
        "Use when the user says what they weigh today. One weigh-in per day: a second one replaces the first. " +
        "The number is never spoken aloud. It is returned as data so a screen can show it. A very large change asks the user to confirm.",
      inputSchema: {
        kg: z.number().min(20).max(300).describe("Weight in kilograms."),
        confirm: z.boolean().optional().describe("Set true only after the user confirmed an unusually large change."),
      },
      outputSchema: {
        outcome: z.enum(["saved", "replaced", "needs_confirmation"]),
        kg: z.number(),
        previousKg: z.number().nullable(),
        deltaKg: z.number().nullable(),
        spoken: spokenField,
      },
      annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    (args) => run(() => service.logWeight(userId, args)),
  );
}
