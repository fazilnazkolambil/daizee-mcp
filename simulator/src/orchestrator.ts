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
    const res = await fetch("/brain/step", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: ctx.messages,
        tools: ctx.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { message?: string } & Partial<BrainStep>;
    if (!res.ok) throw new Error(body.message ?? `Assistant brain error (HTTP ${res.status})`);
    return body as BrainStep;
  }
}
