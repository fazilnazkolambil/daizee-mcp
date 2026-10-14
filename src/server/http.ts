import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ManualClock } from "../memory/index.js";
import type { Store } from "../store/types.js";
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
  /** The user a request acts as when it names none. */
  defaultUser?: string;
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
      res.setHeader("Access-Control-Expose-Headers", "Server-Timing, Mcp-Session-Id");
    }
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (url.pathname === "/health" && method === "GET") {
        sendJson(res, 200, { ok: true, name: "daizee-mcp", demo: opts.demo });
        return;
      }

      // Stub so MCP clients that look for it get a clear, honest answer.
      if (url.pathname === "/.well-known/oauth-protected-resource" && method === "GET") {
        sendJson(res, 200, {
          resource: `${url.protocol}//${headerValue(req, "host") ?? "localhost"}/mcp`,
          resource_name: "daizee-mcp (demo)",
          bearer_methods_supported: [],
          note: "Demo server: no authentication. Production would use OAuth account linking.",
        });
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
        const userId = headerValue(req, "x-daizee-user") ?? url.searchParams.get("user") ?? opts.defaultUser ?? "maya";
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

      if (opts.demo && url.pathname.startsWith("/demo/")) {
        await handleDemo(opts, url.pathname, method, req, res);
        return;
      }

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
