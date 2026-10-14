import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));
const server = "http://localhost:8787";

// `npm run dev:sim` serves the page with hot reload and forwards the service
// routes to the running MCP server. `npm run build:sim` makes simulator/dist,
// which the MCP server then serves itself on one port.
export default defineConfig({
  root,
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
  server: {
    port: 5173,
    proxy: { "/mcp": server, "/demo": server, "/brain": server, "/health": server },
  },
});
