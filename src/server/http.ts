import { existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { BrainError, type Brain } from "../brain/gemini.js";
import { MAX_AUDIO_BYTES, TranscribeError, readRawBody, transcribe } from "../brain/transcribe.js";
import type { ManualClock } from "../memory/index.js";
import type { Store } from "../store/types.js";
import { authenticate, protectedResourceMetadata, publicOrigin, wwwAuthenticate, type AuthConfig } from "./auth.js";
import { createMcpServer } from "./mcpServer.js";
import type { DaizeeService } from "./service.js";

export interface AppOptions {
  service: DaizeeService;
  store: Store;
  clock: ManualClock;
  /** Enables /demo/* controls (advance time, reset). Never enable in production. */
  demo: boolean;
  /** Extra browser origins allowed to call the server (localhost is always allowed). */
  allowedOrigins?: readonly string[];
  /** Real app data: the demo's time travel and reset are refused. */
  liveData?: boolean;
  /** The user a request acts as when it names none. Ignored when `auth` is set. */
  defaultUser?: string;
  /**
   * Per-user auth: /mcp then needs a Firebase ID token (see ./auth.ts), and
   * x-daizee-user is ignored unless auth.allowDemoHeader is on. Without it,
   * the demo header picks the user (fictional in-memory data).
   */
  auth?: AuthConfig;
  /**
   * The demo page's assistant brain (separate from the MCP server, which has no
   * language model). Only reachable in demo mode.
   */
  brain?: Brain | null;
  /** Words the service knows (dishes, allergy terms): helps voice transcription hear them right. */
  vocabulary?: readonly string[];
  /** Folder with the built demo page, served at "/". */
  staticDir?: string;
}

const MAX_BODY_BYTES = 100_000;
const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json", ...extra });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  // Some hosts (for example Firebase Functions) have already parsed the body.
  const preParsed = (req as IncomingMessage & { body?: unknown }).body;
  if (preParsed !== undefined) return preParsed;

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

/** Serves a file from `root`, refusing anything outside it. Returns false if not found. */
function serveStatic(root: string, pathname: string, res: ServerResponse): boolean {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\]|\.\.)+/, "");
  const file = join(root, rel === "" || rel.endsWith(sep) ? join(rel, "index.html") : rel);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return false;
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-cache",
  });
  res.end(readFileSync(file));
  return true;
}

/**
 * The whole web surface. It is a plain (req, res) handler, so it works under
 * node:http today and under Express or Firebase Functions later.
 */
export function createApp(opts: AppOptions): Handler {
  const allowed = new Set(opts.allowedOrigins ?? []);
  const isAllowedOrigin = (origin: string) => LOCALHOST.test(origin) || allowed.has(origin);

  return async (req, res) => {
    const started = process.hrtime.bigint();

    // Report how long the server itself took, separate from network time.
    const writeHead = res.writeHead.bind(res) as (...args: unknown[]) => ServerResponse;
    res.writeHead = ((status: number, ...rest: unknown[]) => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      if (!res.headersSent) res.setHeader("Server-Timing", `app;dur=${ms.toFixed(1)}`);
      return writeHead(status, ...rest);
    }) as typeof res.writeHead;

    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    const origin = headerValue(req, "origin");

    // The MCP spec says servers MUST validate the Origin header.
    if (origin) {
      if (!isAllowedOrigin(origin)) {
        sendJson(res, 403, { error: "Origin not allowed" });
        return;
      }
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, x-daizee-user",
      );
      res.setHeader("Access-Control-Expose-Headers", "Server-Timing, Mcp-Session-Id, WWW-Authenticate");
    }
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (url.pathname === "/health" && method === "GET") {
        sendJson(res, 200, { ok: true, name: "daizee-mcp", demo: opts.demo, liveData: Boolean(opts.liveData) });
        return;
      }

      // RFC 9728: tells an MCP client which authorization server issues tokens for /mcp.
      if (
        (url.pathname === "/.well-known/oauth-protected-resource" ||
          url.pathname === "/.well-known/oauth-protected-resource/mcp") &&
        method === "GET"
      ) {
        sendJson(res, 200, protectedResourceMetadata(publicOrigin(req, opts.auth), opts.auth));
        return;
      }

      if (url.pathname === "/mcp") {
        if (method !== "POST") {
          // Stateless server: there is no session stream to open or close.
          res.setHeader("Allow", "POST");
          sendJson(res, 405, {
            jsonrpc: "2.0",
            error: { code: -32000, message: "Method not allowed. This server is stateless: use POST." },
            id: null,
          });
          return;
        }
        let userId: string;
        if (opts.auth) {
          const result = await authenticate(req, opts.auth);
          if (!result.ok) {
            const challenge = wwwAuthenticate(publicOrigin(req, opts.auth), result);
            sendJson(
              res,
              result.status,
              { jsonrpc: "2.0", error: { code: -32001, message: result.description }, id: null },
              { "WWW-Authenticate": challenge },
            );
            return;
          }
          userId = result.userId;
        } else {
          userId = headerValue(req, "x-daizee-user") ?? url.searchParams.get("user") ?? opts.defaultUser ?? "maya";
        }
        const body = await readBody(req);

        // New server + transport per request: stateless, nothing is shared.
        const server = createMcpServer({ service: opts.service, userId });
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        res.on("close", () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }

      // The demo page's assistant brain: demo mode only, and never the MCP server.
      if (opts.demo && url.pathname === "/brain/status" && method === "GET") {
        sendJson(res, 200, { configured: Boolean(opts.brain), model: opts.brain?.model ?? null });
        return;
      }
      if (opts.demo && url.pathname === "/brain/step") {
        if (method !== "POST") {
          res.setHeader("Allow", "POST");
          sendJson(res, 405, { error: "Use POST" });
          return;
        }
        if (!opts.brain) {
          sendJson(res, 503, { error: "brain_not_configured", message: "No Gemini key is set. Use replay mode." });
          return;
        }
        try {
          sendJson(res, 200, await opts.brain.step(await readBody(req)));
        } catch (err) {
          if (err instanceof BrainError) sendJson(res, err.status, { error: "brain_error", message: err.message });
          else throw err;
        }
        return;
      }

      // Speech to text for the demo page: raw WAV bytes in, { text } out (see src/brain/transcribe.ts).
      if (opts.demo && url.pathname === "/brain/transcribe") {
        if (method !== "POST") {
          res.setHeader("Allow", "POST");
          sendJson(res, 405, { error: "Use POST" });
          return;
        }
        if (!opts.brain) {
          sendJson(res, 503, { error: "brain_not_configured", message: "No Gemini key is set. Use replay mode." });
          return;
        }
        try {
          const audio = await readRawBody(req, MAX_AUDIO_BYTES);
          sendJson(res, 200, { text: await transcribe(opts.brain, audio, opts.vocabulary ?? []) });
        } catch (err) {
          if (err instanceof TranscribeError) sendJson(res, err.status, { error: err.code, message: err.message });
          else if (err instanceof BrainError) sendJson(res, err.status, { error: "brain_error", message: err.message });
          else throw err;
        }
        return;
      }

      if (opts.demo && url.pathname.startsWith("/demo/")) {
        await handleDemo(opts, url.pathname, method, req, res);
        return;
      }

      if (opts.staticDir && method === "GET" && serveStatic(opts.staticDir, url.pathname, res)) return;

      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      sendJson(res, status, {
        jsonrpc: "2.0",
        error: { code: -32603, message: status === 500 ? "Internal server error" : (err as Error).message },
        id: null,
      });
    }
  };
}

async function handleDemo(
  opts: AppOptions,
  pathname: string,
  method: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const clockState = () => ({
    now: new Date(opts.clock.now()).toISOString(),
    advancedDays: opts.clock.advancedDays,
  });

  if (pathname === "/demo/users" && method === "GET") {
    sendJson(res, 200, { users: await opts.store.listUsers(), clock: clockState() });
    return;
  }
  if (pathname === "/demo/clock" && method === "GET") {
    sendJson(res, 200, clockState());
    return;
  }
  if (opts.liveData && (pathname === "/demo/advance-clock" || pathname === "/demo/reset")) {
    sendJson(res, 409, { error: "live_data", message: "Time travel and reset are off while connected to the real app." });
    return;
  }
  if (pathname === "/demo/advance-clock" && method === "POST") {
    const body = (await readBody(req)) as { days?: unknown } | undefined;
    const days = Number(body?.days);
    if (!Number.isFinite(days) || days < 0 || days > 30) {
      sendJson(res, 400, { error: "days must be a number from 0 to 30" });
      return;
    }
    opts.clock.advanceDays(days);
    sendJson(res, 200, clockState());
    return;
  }
  if (pathname === "/demo/reset" && method === "POST") {
    opts.clock.reset();
    await opts.store.reset();
    sendJson(res, 200, { reset: true, clock: clockState() });
    return;
  }
  sendJson(res, 404, { error: "Not found" });
}
