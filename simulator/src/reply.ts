/**
 * Turning tool results into a reply WITHOUT asking the model again.
 *
 * Every tool already returns a short, plain `spoken` sentence. In "fast" mode
 * the assistant says that sentence instead of making a second model call to
 * rephrase it, which halves the wait and the cost of a turn. Pure functions, no
 * DOM, so the page, replay mode and the eval all behave identically.
 */

export interface ToolResultLike {
  output: unknown;
}

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
 * Fast replies are used only when exactly ONE tool ran and it said something.
 * Stitching several tool sentences together ("Got it, I'll remember that for a
 * year. Got it, I'll remember that for 7 days.") reads clumsily, so a turn that
 * used several tools still gets the model's own wording.
 */
export function canReplyFast(results: readonly ToolResultLike[]): boolean {
  return results.length === 1 && sentenceOf(results[0] as ToolResultLike) !== "";
}
