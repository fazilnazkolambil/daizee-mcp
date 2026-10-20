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
        "How the user's day is going: calories and macros eaten vs goal, what is left, and notes about to expire (check-ins). Use for 'how am I doing today?' or when the add-on opens. For today's focus, use get_today_plan.",
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
        "Today's focus and eat/move/recover steps from the Daizee app, plus any afternoon nudge. Use for 'what should I focus on today?' or 'what's my plan?'. Read only.",
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
        "Log food the user ate or drank. One item per food; give calories/macros (totals per item) only if known, otherwise they are estimated. Returns today's totals and safetyFlags for conflicts with stored allergies or diets. The check is word matching, so an empty safetyFlags list is NOT a clearance. Repeats never double count.",
      inputSchema: {
        mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).describe("Which meal this was."),
        items: z
          .array(
            z.object({
              name: z.string().min(1).max(60).describe("The food, e.g. 'masala dosa'."),
              quantity: z.number().positive().max(20).optional().describe("How many servings. Default 1."),
              calories: z.number().min(0).max(5000).optional().describe("Total calories for this item, if known."),
              protein: z.number().min(0).max(500).optional().describe("Total grams of protein, if known."),
              carbs: z.number().min(0).max(1000).optional().describe("Total grams of carbs, if known."),
              fat: z.number().min(0).max(500).optional().describe("Total grams of fat, if known."),
            }),
          )
          .min(1)
          .max(8),
        idempotencyKey: z.string().max(64).optional().describe("Same key never logs twice."),
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
        "Save a personal fact (allergy, diet, symptom, habit, preference, goal, travel). Save immediately; do not ask permission. Pass durationDays if the user named a time; else category TTL (allergy ~1y, symptom ~5d, habit ~60d). Repeats refresh.",
      inputSchema: {
        category: z.enum(MEMORY_CATEGORIES).describe("allergy, constraint (a diet or rule), symptom, habit, food_preference, coach_preference or goal."),
        text: z.string().min(3).max(120).describe("The fact, in a few words."),
        durationDays: z.number().int().min(1).max(365).optional().describe("If user named a duration: 2 days → 2, this week → 7. Omit if no time said."),
        confidence: z.number().min(0).max(1).optional().describe("Below 0.6 asks the user to confirm."),
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
        "What is remembered about the user (up to 5, allergies first, with days left). Use when asked, or before advice that depends on allergies, injuries or preferences.",
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
        "Forget or finish a note ('my knee is better'). Two steps, enforced by the service: call without confirm to find it and ask the user; only after they say yes, call again with confirm true. Pass memoryId or a short query such as 'knee'.",
      inputSchema: {
        memoryId: z.string().max(64).optional(),
        query: z.string().min(2).max(60).optional().describe("A word or two, e.g. 'knee'."),
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
        "Log today's weight in kg (one per day; a second replaces it). It is shown on screen, never spoken aloud. A very large change asks for confirmation.",
      inputSchema: {
        kg: z.number().min(20).max(300).describe("Weight in kilograms."),
        confirm: z.boolean().optional().describe("True only after the user confirmed a large change."),
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
