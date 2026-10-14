import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * A REAL MCP client: the official SDK's Client + StreamableHTTPClientTransport.
 * Every message it sends is recorded for the wire-trace panel through a wrapped
 * fetch, so a viewer sees the actual initialize / tools/list / tools/call
 * traffic, not a mock-up.
 */

export interface TraceEntry {
  id: number;
  method: string;
  tool?: string;
  httpMethod: string;
  status: number;
  roundTripMs: number;
  /** How long the server itself spent, from the Server-Timing header. */
  serverMs: number | null;
  request: unknown;
  response: unknown;
}

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolOutput {
  isError?: boolean;
  structured?: Record<string, unknown>;
  text: string;
}

let nextId = 1;

export class McpSession {
  private client: Client | null = null;
  tools: ToolInfo[] = [];

  constructor(
    private readonly userId: string,
    private readonly onTrace: (entry: TraceEntry) => void,
  ) {}

  private tracedFetch: typeof fetch = async (input, init) => {
    const started = performance.now();
    const res = await fetch(input, init);
    const roundTripMs = performance.now() - started;

    let request: unknown = null;
    try {
      request = init?.body ? JSON.parse(String(init.body)) : null;
    } catch {
      request = String(init?.body ?? "");
    }
    let response: unknown = null;
    try {
      const text = await res.clone().text();
      response = text ? JSON.parse(text) : null;
    } catch {
      response = null;
    }
    const timing = /dur=([\d.]+)/.exec(res.headers.get("server-timing") ?? "");
    const rpc = (request ?? {}) as { method?: string; params?: { name?: string } };

    this.onTrace({
      id: nextId++,
      method: rpc.method ?? `${init?.method ?? "GET"} (no message)`,
      tool: rpc.params?.name,
      httpMethod: init?.method ?? "GET",
      status: res.status,
      roundTripMs,
      serverMs: timing ? Number(timing[1]) : null,
      request,
      response,
    });
    return res;
  };

  async connect(): Promise<void> {
    const client = new Client({ name: "daizee-simulator", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL("/mcp", window.location.origin), {
      fetch: this.tracedFetch,
      requestInit: { headers: { "x-daizee-user": this.userId } },
    });
    await client.connect(transport);
    const { tools } = await client.listTools();
    this.client = client;
    this.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolOutput> {
    if (!this.client) throw new Error("Not connected");
    const result = await this.client.callTool({ name, arguments: args });
    const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
    const text = content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(" ");
    return {
      isError: Boolean(result.isError),
      structured: result.structuredContent as Record<string, unknown> | undefined,
      text,
    };
  }

  async close(): Promise<void> {
    await this.client?.close().catch(() => undefined);
    this.client = null;
  }
}
