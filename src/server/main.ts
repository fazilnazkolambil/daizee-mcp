import { createServer } from "node:http";
import { ManualClock } from "../memory/index.js";
import { InMemoryStore } from "../store/index.js";
import { loadSeedData } from "./data.js";
import { createApp } from "./http.js";
import { DaizeeService } from "./service.js";

/** Wires everything together. Used by `npm start` and by the tests. */
export function buildApp(options: { demo?: boolean; allowedOrigins?: string[] } = {}) {
  const data = loadSeedData();
  const clock = new ManualClock();
  const store = new InMemoryStore(data.users, clock);
  const service = new DaizeeService(store, clock, data.dishes, data.rules);
  const handler = createApp({
    service,
    store,
    clock,
    demo: options.demo ?? false,
    allowedOrigins: options.allowedOrigins,
  });
  return { handler, service, store, clock };
}

function main(): void {
  const port = Number(process.env.PORT ?? 8787);
  const demo = process.env.DAIZEE_DEMO !== "0"; // on by default for the local demo
  const origins = (process.env.DAIZEE_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const { handler } = buildApp({ demo, allowedOrigins: origins });

  createServer((req, res) => void handler(req, res)).listen(port, () => {
    console.log(`daizee-mcp listening on http://localhost:${port}/mcp  (demo controls ${demo ? "ON" : "off"})`);
    console.log("Demo users: maya (has history), sam (blank). Send header x-daizee-user to choose.");
  });
}

// Run only when started directly, not when imported by tests.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
