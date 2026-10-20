/**
 * Turning tool results into a reply WITHOUT asking the model again.
 *
 * Every tool already returns a short, plain `spoken` sentence. In "fast" mode
 * the assistant says that sentence instead of making a second model call to
 * rephrase it, which halves the wait and the cost of a turn. Pure functions, no
 * DOM, so the page, replay mode and the eval all behave identically.
 */

export interface ToolResultLike {
  name?: string;
  output: unknown;
}

/**
 * Tools whose sentence IS the answer: they did something and say what. A
 * lookup (recall_what_you_know, get_day_progress, get_today_plan) is often
 * context for another question ("what can I eat for dinner?"), so after one
 * the model always gets its second call to actually answer.
 */
export const ACTION_TOOLS: ReadonlySet<string> = new Set(["log_meal", "log_weight", "remember_about_user", "resolve_memory"]);

function sentenceOf(result: ToolResultLike): string {
  const o = result.output as { spoken?: unknown; message?: unknown } | null;
  const text = typeof o?.spoken === "string" ? o.spoken : typeof o?.message === "string" ? o.message : "";
  return text.trim();
}

/** The reply made of what the tools themselves said. */
export function replyFromResults(results: readonly ToolResultLike[]): string {
  return results.map(sentenceOf).filter(Boolean).join(" ") || "Done.";
}

/**
 * Fast replies are used only when exactly ONE action tool ran and it said something.
 * Stitching several tool sentences together ("Got it, I'll remember that for a
 * year. Got it, I'll remember that for 7 days.") reads clumsily, so a turn that
 * used several tools still gets the model's own wording.
 */
export function canReplyFast(results: readonly ToolResultLike[]): boolean {
  if (results.length !== 1) return false;
  const only = results[0] as ToolResultLike;
  return ACTION_TOOLS.has(only.name ?? "") && sentenceOf(only) !== "";
}
