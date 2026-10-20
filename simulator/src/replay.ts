import type { BrainMessage, BrainStep } from "../../src/brain/gemini.js";
import type { Orchestrator } from "./orchestrator.js";
import type { ToolInfo } from "./mcpClient.js";

/**
 * Replay mode: the assistant's DECISIONS are scripted (so judges need no keys
 * and the demo is repeatable), but every tool call is still made for real over
 * MCP, and the reply is whatever the real service returns. Only the "which
 * tool should I call?" step is canned. The page labels this mode clearly.
 */

interface Scene {
  id: string;
  /** The phrase shown as a one-click suggestion. */
  say: string;
  match: RegExp;
  calls: Array<{ name: string; args: Record<string, unknown> }>;
}

export const SCENES: Scene[] = [
  {
    id: "teach",
    say: "I'm allergic to peanuts, and my left knee is sore this week.",
    match: /allerg.*peanut|peanut.*allerg/i,
    calls: [
      { name: "remember_about_user", args: { category: "allergy", text: "allergic to peanuts" } },
      { name: "remember_about_user", args: { category: "symptom", text: "left knee is sore", durationDays: 7 } },
    ],
  },
  {
    id: "padthai",
    say: "Log pad thai for dinner.",
    match: /pad thai/i,
    calls: [{ name: "log_meal", args: { mealType: "dinner", items: [{ name: "pad thai" }] } }],
  },
  {
    id: "morning",
    say: "Good morning, how am I doing today?",
    match: /good morning|how am i doing|my progress/i,
    calls: [{ name: "get_day_progress", args: {} }],
  },
  {
    id: "focus",
    say: "What should I focus on today?",
    match: /focus on today|today'?s plan|what'?s my plan/i,
    calls: [{ name: "get_today_plan", args: {} }],
  },
  {
    id: "know",
    say: "What do you know about me?",
    match: /what do you (know|remember)|remember about me/i,
    calls: [{ name: "recall_what_you_know", args: {} }],
  },
  {
    id: "better",
    say: "My knee is better now.",
    match: /knee.*(better|fine|okay|ok|healed)|forget.*knee/i,
    calls: [{ name: "resolve_memory", args: { query: "knee", confirm: false } }],
  },
  {
    id: "yes",
    say: "Yes, forget it.",
    match: /^\s*(yes|yeah|yep|sure|confirm|go ahead)\b/i,
    calls: [{ name: "resolve_memory", args: { query: "knee", confirm: true } }],
  },
  {
    id: "breakfast",
    say: "I had two idlis and sambar for breakfast.",
    match: /idli|breakfast/i,
    calls: [{ name: "log_meal", args: { mealType: "breakfast", items: [{ name: "idli" }, { name: "sambar" }] } }],
  },
  {
    id: "weight",
    say: "I weigh 61.5 kilos today.",
    match: /weigh|weight/i,
    calls: [{ name: "log_weight", args: { kg: 61.5 } }],
  },
];

function lastUserText(messages: readonly BrainMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user") return m.text;
  }
  return "";
}

export class ReplayOrchestrator implements Orchestrator {
  readonly label = "Replay (scripted decisions, real MCP calls)";

  async step(ctx: { messages: BrainMessage[]; tools: ToolInfo[] }): Promise<BrainStep> {
    const last = ctx.messages[ctx.messages.length - 1];

    // After the tools ran, the reply is what the real service said.
    if (last?.role === "tool") {
      const spoken = last.results
        .map((r) => (r.output as { spoken?: string; message?: string })?.spoken ?? (r.output as { message?: string })?.message ?? "")
        .filter(Boolean)
        .join(" ");
      return { type: "final", text: spoken || "Done.", raw: [] };
    }

    const said = lastUserText(ctx.messages);
    const scene = SCENES.find((s) => s.match.test(said));
    if (!scene) {
      return {
        type: "final",
        text: "In replay mode I only know the demo script. Try one of the suggested phrases.",
        raw: [],
      };
    }
    const known = new Set(ctx.tools.map((t) => t.name));
    const calls = scene.calls.filter((c) => known.has(c.name));
    return { type: "calls", calls, raw: [] };
  }
}
