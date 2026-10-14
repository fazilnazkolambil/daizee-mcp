import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DaizeeService } from "./service.js";
import { registerTools } from "./tools.js";

export const SERVER_INFO = { name: "daizee-mcp", version: "0.1.0" } as const;

/**
 * Builds a fresh MCP server for ONE request. The service is stateless (no
 * session id), so a new server per request is the correct, simplest pattern.
 */
export function createMcpServer(params: { service: DaizeeService; userId: string }): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "Daizee keeps a person's health notes (allergies, injuries, habits) and meal log, and remembers them across conversations. " +
      "Notes expire on purpose. Call recall_what_you_know before advising on food, and log_meal for anything the user ate.",
  });
  registerTools(server, params.service, params.userId);

  // The SDK advertises tools.listChanged by default. Our tool list is fixed
  // (Alexa+ captures it at deploy time and we never change it), so we only
  // declare what we honor.
  const caps = (server.server as unknown as { _capabilities?: { tools?: { listChanged?: boolean } } })._capabilities;
  if (caps?.tools) caps.tools.listChanged = false;
  return server;
}
