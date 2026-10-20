/**
 * The demo page's "assistant brain".
 *
 * IMPORTANT: this is NOT part of the MCP server. The MCP server (src/server)
 * has no language model in it. This module plays the part of the assistant
 * (Alexa+ in the real world): it reads what the user said, decides which MCP
 * tool to call, and writes the final reply. It runs on the demo's own backend
 * only so the Gemini key stays secret and out of the browser.
 */

/** A neutral conversation format, converted to Gemini's format here. */
export type BrainMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text?: string; calls?: BrainCall[]; raw?: unknown[] }
  | { role: "tool"; results: Array<{ id?: string; name: string; output: unknown }> };

export interface BrainCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface BrainTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export type BrainStep =
  | { type: "calls"; calls: BrainCall[]; raw: unknown[]; usage?: Usage }
  | { type: "final"; text: string; raw: unknown[]; usage?: Usage };

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface BrainOptions {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  /** Replaceable in tests so they do not really wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Hard cap on model calls per UTC day, so a public demo cannot run up a bill. */
  dailyCap?: number;
  now?: () => number;
  /**
   * If the model has not answered a tool-choice step after this many ms, send
   * the same request once more and use whichever answer arrives first (Gemini's
   * response time varies from about 1 s to over 10 s for the same request).
   * 0 turns it off. Default HEDGE_AFTER_MS.
   */
  hedgeAfterMs?: number;
}

export const LIMITS = {
  maxMessages: 40,
  maxTools: 12,
  maxTextChars: 2000,
  /** Total JSON size of one request (messages + tools), so one cap unit cannot carry megabytes. */
  maxRequestChars: 60_000,
  maxOutputTokens: 600,
} as const;

/** Fixed on the server. The browser cannot change it. */
export const SYSTEM_PROMPT = [
  "You are a SIMULATED voice assistant used to demonstrate a health-memory service. You are not Alexa and you are not affiliated with Amazon.",
  "You can only act through the tools you are given. Never invent meals, weights, allergies or notes: if you need facts, call a tool.",
  "Keep every reply to at most two short, plain sentences. No lists, no markdown, no emoji. Offer at most 3 options.",
  "When the user says they ate or drank something, call log_meal with each food as an item and the right mealType (guess from the time words, else snack).",
  "When the user shares a personal fact (allergy, diet, injury or symptom, habit, preference, goal, travel, or schedule), call remember_about_user on that same turn once per fact with the right category. Do not ask whether to remember; save first, then reply conversationally.",
  "If the user named how long it applies, always pass durationDays (for 2 days use 2, this week use 7). Omit durationDays only when they said nothing about time.",
  "Before giving food advice, call recall_what_you_know. If a tool returns safetyFlags, tell the user clearly and briefly, and remind them it is only a reminder.",
  "To forget or finish a note, call resolve_memory without confirm first and ask the user. Only call it again with confirm true after the user clearly says yes.",
  "Never say the user's body weight out loud: say it is on the screen. Add a short 'this is not medical advice' to any health advice.",
  "Ask the user to confirm only for forget, a large weight change, or when a tool returns needs_confirmation.",
].join(" ");

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: unknown; id?: string };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

const MAX_RETRY_WAIT_MS = 12_000;
const TRANSIENT_RETRY_MS = 1_500;
export const HEDGE_AFTER_MS = 3_000;
/** After a 429, no backups for this long: on a free key they would only use up the minute's quota. */
const HEDGE_PAUSE_AFTER_429_MS = 60_000;

const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

/** How long Google asks us to wait, from the error body. Null if it does not say. */
async function retryDelayMs(res: Response): Promise<number | null> {
  try {
    const body = (await res.clone().json()) as { error?: { details?: Array<{ retryDelay?: string }> } };
    const delay = body.error?.details?.find((d) => typeof d.retryDelay === "string")?.retryDelay;
    const seconds = delay ? Number.parseFloat(delay) : Number.NaN;
    return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) + 250 : null;
  } catch {
    return null;
  }
}

export class BrainError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BrainError";
  }
}

/** Validates what the browser sent. Throws BrainError (400) when it is not acceptable. */
export function validateRequest(body: unknown): { messages: BrainMessage[]; tools: BrainTool[] } {
  const b = body as { messages?: unknown; tools?: unknown } | null;
  if (JSON.stringify(body ?? null).length > LIMITS.maxRequestChars) {
    throw new BrainError("That request is too large.", 400);
  }
  if (!b || !Array.isArray(b.messages) || !Array.isArray(b.tools)) {
    throw new BrainError("Expected { messages: [], tools: [] }", 400);
  }
  if (b.messages.length === 0 || b.messages.length > LIMITS.maxMessages) {
    throw new BrainError(`messages must have 1 to ${LIMITS.maxMessages} items`, 400);
  }
  if (b.tools.length === 0 || b.tools.length > LIMITS.maxTools) {
    throw new BrainError(`tools must have 1 to ${LIMITS.maxTools} items`, 400);
  }
  for (const m of b.messages as BrainMessage[]) {
    if (!m || (m.role !== "user" && m.role !== "assistant" && m.role !== "tool")) {
      throw new BrainError("Unknown message role", 400);
    }
    if (m.role === "user" && (typeof m.text !== "string" || m.text.length > LIMITS.maxTextChars)) {
      throw new BrainError("User text missing or too long", 400);
    }
  }
  for (const t of b.tools as BrainTool[]) {
    if (!t || typeof t.name !== "string" || !/^[a-z0-9_]{1,64}$/i.test(t.name) || typeof t.inputSchema !== "object") {
      throw new BrainError("Invalid tool definition", 400);
    }
  }
  return { messages: b.messages as BrainMessage[], tools: b.tools as BrainTool[] };
}

/** Neutral messages -> Gemini contents. Raw model parts are passed back untouched. */
export function toGeminiContents(messages: readonly BrainMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      contents.push({ role: "user", parts: [{ text: m.text }] });
    } else if (m.role === "assistant") {
      // Gemini needs its own parts (including thought signatures) echoed back.
      if (Array.isArray(m.raw) && m.raw.length) {
        contents.push({ role: "model", parts: m.raw as GeminiPart[] });
      } else {
        const parts: GeminiPart[] = [];
        if (m.text) parts.push({ text: m.text });
        for (const c of m.calls ?? []) parts.push({ functionCall: { name: c.name, args: c.args, ...(c.id ? { id: c.id } : {}) } });
        if (parts.length) contents.push({ role: "model", parts });
      }
    } else {
      contents.push({
        role: "user",
        parts: m.results.map((r) => ({
          functionResponse: { name: r.name, ...(r.id ? { id: r.id } : {}), response: { output: r.output } },
        })),
      });
    }
  }
  return contents;
}

/**
 * The model gets a slimmer copy of each tool's schema: no "$schema" marker and
 * none of the numeric/length limits. The MCP server still enforces every limit
 * (a bad value comes back as an error the model can read), so dropping them
 * here only saves tokens on every call.
 */
const NOISE = new Set(["$schema", "additionalProperties", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems"]);
export function cleanSchema(schema: unknown): Record<string, unknown> {
  if (Array.isArray(schema)) return schema.map((x) => cleanSchema(x)) as unknown as Record<string, unknown>;
  if (schema === null || typeof schema !== "object") return schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (NOISE.has(k)) continue;
    out[k] = cleanSchema(v);
  }
  return out;
}

export function parseGeminiResponse(json: unknown): BrainStep {
  const r = json as {
    candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    promptFeedback?: { blockReason?: string };
  };
  const usage: Usage = {
    inputTokens: r.usageMetadata?.promptTokenCount,
    outputTokens: r.usageMetadata?.candidatesTokenCount,
  };
  const parts = r.candidates?.[0]?.content?.parts ?? [];
  if (!parts.length) {
    const why = r.promptFeedback?.blockReason ?? r.candidates?.[0]?.finishReason ?? "empty response";
    throw new BrainError(`The model returned nothing (${why})`, 502);
  }
  const calls: BrainCall[] = parts
    .filter((p) => p.functionCall)
    .map((p) => ({
      ...(p.functionCall?.id ? { id: p.functionCall.id } : {}),
      name: p.functionCall?.name ?? "",
      args: p.functionCall?.args ?? {},
    }));
  if (calls.length) return { type: "calls", calls, raw: parts, usage };
  const text = parts
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join(" ")
    .trim();
  return { type: "final", text, raw: parts, usage };
}

export class Brain {
  private usedToday = 0;
  private dayStamp = "";

  constructor(private readonly opts: BrainOptions) {}

  get model(): string {
    return this.opts.model;
  }

  /** Backup requests sent so far (each also counts toward the daily cap). */
  hedgesSent = 0;
  private lastRateLimitedAt = -Infinity;

  private checkCap(): void {
    const now = (this.opts.now ?? Date.now)();
    const stamp = new Date(now).toISOString().slice(0, 10);
    if (stamp !== this.dayStamp) {
      this.dayStamp = stamp;
      this.usedToday = 0;
    }
    if (this.usedToday >= (this.opts.dailyCap ?? 300)) {
      throw new BrainError("The demo's daily assistant limit was reached. Use replay mode.", 429);
    }
    this.usedToday++;
  }

  async step(body: unknown): Promise<BrainStep> {
    const { messages, tools } = validateRequest(body);
    return parseGeminiResponse(
      await this.generate({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: toGeminiContents(messages),
        tools: [
          {
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: (t.description ?? "").slice(0, 1200),
              parametersJsonSchema: cleanSchema(t.inputSchema),
            })),
          },
        ],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        generationConfig: { temperature: 0.2, maxOutputTokens: LIMITS.maxOutputTokens },
      }, { hedge: true }),
    );
  }

  /**
   * One generateContent call with every shared safeguard: it counts toward the
   * daily cap, the key travels only in a header, a short 429 is waited out and
   * retried once, a transient 503 is retried once, and failures become plain
   * English (the provider's body is never forwarded). Returns the parsed JSON.
   * Callers validate their input first, so a bad request costs nothing.
   *
   * With `hedge`, a slow answer gets one backup request (see hedgeAfterMs).
   * Transcription does not hedge: an audio upload is big and legitimately slow.
   */
  async generate(payload: unknown, opts: { hedge?: boolean } = {}): Promise<unknown> {
    this.checkCap();

    const doFetch = this.opts.fetchImpl ?? fetch;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.opts.model)}:generateContent`;
    const request = {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.opts.apiKey },
      body: JSON.stringify(payload),
    };

    const hedgeAfter = opts.hedge ? (this.opts.hedgeAfterMs ?? HEDGE_AFTER_MS) : 0;
    const send = async (): Promise<Response> => {
      try {
        return hedgeAfter > 0 ? await this.sendHedged(doFetch, url, request, hedgeAfter) : await doFetch(url, request);
      } catch {
        // A dropped connection or DNS failure: say so plainly (never forward internals).
        throw new BrainError("Could not reach the assistant model. Please try again, or switch to replay.", 502);
      }
    };

    let res = await send();
    if (res.status === 429) {
      this.lastRateLimitedAt = (this.opts.now ?? Date.now)();
      // Free keys allow only ~15 requests a minute. A short wait usually clears it.
      const wait = await retryDelayMs(res);
      if (wait !== null && wait <= MAX_RETRY_WAIT_MS) {
        await (this.opts.sleep ?? sleep)(wait);
        res = await send();
      }
    }

    if (res.status === 503) {
      // "High demand" spikes usually clear within a moment: one short retry.
      await (this.opts.sleep ?? sleep)(TRANSIENT_RETRY_MS);
      res = await send();
    }

    if (!res.ok) {
      // Never forward the provider's body: it can echo request details.
      if (res.status === 429) {
        throw new BrainError(
          "The assistant model is rate-limited right now (free Gemini keys allow about 15 requests a minute). Wait a few seconds and try again, or switch to replay.",
          429,
        );
      }
      throw new BrainError(
        res.status === 503
          ? "The assistant model is busy right now. Please try again in a moment, or switch to replay."
          : `The assistant model returned HTTP ${res.status}`,
        502,
      );
    }
    try {
      return await res.json();
    } catch {
      throw new BrainError("The assistant model sent an unreadable reply. Please try again.", 502);
    }
  }

  /**
   * Sends the request; if no answer after `afterMs`, sends it once more. The
   * first OK answer wins and the other request is cancelled. If neither is OK,
   * the first one that finished is returned, so the usual 429/503 handling
   * applies. A backup counts toward the daily cap and is skipped when the cap
   * is used up. Rejects only when both requests fail to connect.
   */
  private sendHedged(doFetch: typeof fetch, url: string, request: RequestInit, afterMs: number): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      const controllers: AbortController[] = [];
      let running = 0;
      let done = false;
      let firstNotOk: Response | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (res: Response | undefined, winner: AbortController | undefined, err?: unknown) => {
        done = true;
        if (timer) clearTimeout(timer);
        for (const c of controllers) if (c !== winner) c.abort();
        if (res) resolve(res);
        else reject(err);
      };
      const launch = () => {
        const c = new AbortController();
        controllers.push(c);
        running++;
        doFetch(url, { ...request, signal: c.signal }).then(
          (res) => {
            running--;
            if (done) return;
            if (res.ok) return finish(res, c);
            firstNotOk ??= res;
            if (running === 0) finish(firstNotOk, c);
          },
          (err) => {
            running--;
            if (done) return;
            if (running === 0) finish(firstNotOk, undefined, err);
          },
        );
      };

      launch();
      timer = setTimeout(() => {
        if (done || firstNotOk) return; // answered, or already failing: let the normal retries handle it
        if ((this.opts.now ?? Date.now)() - this.lastRateLimitedAt < HEDGE_PAUSE_AFTER_429_MS) return;
        try {
          this.checkCap();
        } catch {
          return; // daily cap reached: no backup
        }
        this.hedgesSent++;
        launch();
      }, afterMs);
    });
  }
}

/** Builds a Brain from the environment, or returns null when no key is set. */
export function brainFromEnv(env: NodeJS.ProcessEnv = process.env): Brain | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new Brain({
    apiKey,
    model: env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite",
    dailyCap: Number(env.DAIZEE_BRAIN_DAILY_CAP) || 300,
    // GEMINI_HEDGE_AFTER_MS=0 turns backup requests off (e.g. to save a free key's quota).
    hedgeAfterMs: env.GEMINI_HEDGE_AFTER_MS !== undefined && env.GEMINI_HEDGE_AFTER_MS.trim() !== "" ? Math.max(0, Number(env.GEMINI_HEDGE_AFTER_MS) || 0) : undefined,
  });
}
