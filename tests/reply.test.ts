import { describe, expect, it } from "vitest";
import { cleanSchema } from "../src/brain/gemini.js";
import { buildApp } from "../src/server/main.js";
import { canReplyFast, replyFromResults } from "../simulator/src/reply.js";

describe("replyFromResults / canReplyFast (fast replies)", () => {
  it("uses the tool's own sentence", () => {
    expect(replyFromResults([{ output: { spoken: "Logged your dinner, about 600 calories." } }])).toBe("Logged your dinner, about 600 calories.");
  });
  it("falls back to an error message, then to 'Done.'", () => {
    expect(replyFromResults([{ output: { isError: true, message: "Unknown demo user: x" } }])).toBe("Unknown demo user: x");
    expect(replyFromResults([{ output: {} }])).toBe("Done.");
    expect(replyFromResults([])).toBe("Done.");
  });
  it("joins several sentences when asked to", () => {
    expect(replyFromResults([{ output: { spoken: "One." } }, { output: { spoken: "Two." } }])).toBe("One. Two.");
  });
  it("is fast only for exactly one action tool that said something", () => {
    expect(canReplyFast([{ name: "log_meal", output: { spoken: "Logged." } }])).toBe(true);
    expect(canReplyFast([{ name: "log_meal", output: { spoken: "Hi." } }, { name: "log_weight", output: { spoken: "Again." } }])).toBe(false);
    expect(canReplyFast([{ name: "log_meal", output: {} }])).toBe(false);
    expect(canReplyFast([{ output: { spoken: "No name." } }])).toBe(false);
    expect(canReplyFast([])).toBe(false);
  });
  it("lets the model answer when the user also asked something", () => {
    const saved = [{ name: "remember_about_user", output: { spoken: "Got it, I'll remember that for 7 more days." } }];
    expect(canReplyFast(saved, "My knee hurts a lot today, should I still go for my walk?")).toBe(false);
    expect(canReplyFast(saved, "my knee hurts so should I skip my walk")).toBe(false);
    expect(canReplyFast(saved, "What can I eat")).toBe(false);
    expect(canReplyFast(saved, "I'm going to Kerala for 1 week")).toBe(true);
    expect(canReplyFast(saved, "I'm allergic to peanuts, and my left knee is sore this week.")).toBe(true);
  });
  it("lets the model explain or ask after a tool error, instead of reading the error out", () => {
    expect(canReplyFast([{ name: "log_meal", output: { isError: true, message: "\"breakfast\" is not a food, so nothing was logged." } }], "585 x for breakfast")).toBe(false);
  });
  it("lets the model answer after a lookup ('what can I eat for dinner?' recalls first)", () => {
    for (const name of ["recall_what_you_know", "get_day_progress", "get_today_plan"]) {
      expect(canReplyFast([{ name, output: { spoken: "I know 5 things." } }])).toBe(false);
    }
  });
});

describe("cleanSchema (the slimmer copy the model sees)", () => {
  it("drops limits and markers but keeps what the model needs to call a tool", () => {
    const slim = cleanSchema({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      additionalProperties: false,
      required: ["kg"],
      properties: {
        kg: { type: "number", minimum: 20, maximum: 300, description: "Weight in kilograms." },
        category: { type: "string", enum: ["allergy", "habit"] },
        items: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", properties: { name: { type: "string", maxLength: 60 } }, required: ["name"] } },
      },
    }) as any;
    const text = JSON.stringify(slim);
    for (const noise of ["$schema", "additionalProperties", "minimum", "maximum", "minItems", "maxItems", "maxLength"]) expect(text).not.toContain(noise);
    expect(slim.required).toEqual(["kg"]);
    expect(slim.properties.category.enum).toEqual(["allergy", "habit"]);
    expect(slim.properties.kg.description).toBe("Weight in kilograms.");
    expect(slim.properties.items.items.required).toEqual(["name"]);
  });
});

describe("the model's tool menu stays small (it is re-read on every call)", () => {
  it("is under 3,850 characters for all seven tools (six were 5,195 before trimming; get_today_plan adds about 180)", async () => {
    const { handler } = buildApp({ demo: true });
    const { createServer } = await import("node:http");
    const server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const port = (server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const { result } = (await res.json()) as { result: { tools: Array<{ name: string; description: string; inputSchema: unknown }> } };
    await new Promise<void>((ok) => server.close(() => ok()));
    const menu = JSON.stringify(result.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: cleanSchema(t.inputSchema) })));
    expect(result.tools).toHaveLength(7);
    expect(menu.length).toBeLessThan(3850);
  });
});
