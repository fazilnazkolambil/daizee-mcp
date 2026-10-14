import type { BrainMessage, BrainStep } from "../../src/brain/gemini.js";
import type { ToolInfo } from "./mcpClient.js";

export type { BrainMessage as Msg, BrainStep as Step };

/**
 * The "assistant": decides which MCP tool to call and writes the final reply.
 * Two implementations: Gemini (live) and Replay (scripted decisions).
 * In BOTH, every tool call goes through the real MCP client.
 */
export interface Orchestrator {
  readonly label: string;
  step(ctx: { messages: BrainMessage[]; tools: ToolInfo[] }): Promise<BrainStep>;
}

/** Live: asks the demo backend (which holds the Gemini key) what to do next. */
export class GeminiOrchestrator implements Orchestrator {
  constructor(readonly label: string) {}

  async step(ctx: { messages: BrainMessage[]; tools: ToolInfo[] }): Promise<BrainStep> {
    const payload = JSON.stringify({
      messages: ctx.messages,
      tools: ctx.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    });
    // A brain step has no side effects (it only asks the model what to do next), so one retry is safe.
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch("/brain/step", { method: "POST", headers: { "content-type": "application/json" }, body: payload });
      const text = await res.text();
      let body: ({ message?: string } & Partial<BrainStep>) | null = null;
      try {
        body = JSON.parse(text);
      } catch {
        /* an HTML error page from the hosting layer, not our JSON */
      }
      if (!body) {
        if (attempt === 0 && res.status >= 500) {
          await new Promise((ok) => setTimeout(ok, 800));
          continue;
        }
        throw new Error("The demo server had a hiccup. Please try again.");
      }
      if (!res.ok) throw new Error(body.message ?? `Assistant brain error (HTTP ${res.status})`);
      return body as BrainStep;
    }
    throw new Error("The demo server had a hiccup. Please try again.");
  }
}
