import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brainFromEnv, type Brain } from "../brain/gemini.js";
import { ttsFromEnv, type CloudTts } from "../brain/tts.js";
import { ManualClock } from "../memory/index.js";
import { firebaseAuthFromEnv, firestoreStoreFromEnv, InMemoryStore, type Store } from "../store/index.js";
import { loadSeedData } from "./data.js";
import type { AuthConfig } from "./auth.js";
import { createApp } from "./http.js";
import { loadSecrets } from "./secrets.js";
import { DaizeeService } from "./service.js";

/** Wires everything together. Used by `npm start` and by the tests. */
export function buildApp(
  options: {
    demo?: boolean;
    allowedOrigins?: string[];
    brain?: Brain | null;
    tts?: CloudTts | null;
    staticDir?: string;
    /** Real app data (FirestoreStore). Turns off the demo's time travel and reset. */
    live?: { store: Store; clock: ManualClock; defaultUser: string };
    /** Per-user auth on /mcp (Firebase ID tokens). main() always sets it with STORE=firestore. */
    auth?: AuthConfig;
  } = {},
) {
  const data = loadSeedData();
  const clock = options.live?.clock ?? new ManualClock();
  const store = options.live?.store ?? new InMemoryStore(data.users, clock);
  const service = new DaizeeService(store, clock, data.dishes, data.rules);
  const handler = createApp({
    service,
    store,
    clock,
    demo: options.demo ?? false,
    liveData: Boolean(options.live),
    defaultUser: options.live?.defaultUser,
    auth: options.auth,
    allowedOrigins: options.allowedOrigins,
    brain: options.brain ?? null,
    tts: options.tts ?? null,
    staticDir: options.staticDir,
    vocabulary: [
      ...data.dishes.flatMap((d) => [d.name, ...d.aliases]),
      ...data.rules.flatMap((r) => r.memoryTerms),
      "log", "breakfast", "lunch", "dinner", "snack", "egg", "eggs", "ate", "allergic", "knee", "sore", "kilos", "calories", "forget", "remember",
    ],
  });
  return { handler, service, store, clock };
}

async function main(): Promise<void> {
  // Optional local settings (never committed). A missing file is fine.
  try {
    process.loadEnvFile(".env");
  } catch {
    /* no .env: zero-configuration mode */
  }
  // Secrets (the Gemini key) come from Secret Manager when DAIZEE_SECRETS_PROJECT is set.
  const loadedSecrets = await loadSecrets(process.env);
  if (loadedSecrets.length) console.log(`Secrets from Secret Manager (${process.env.DAIZEE_SECRETS_PROJECT}): ${loadedSecrets.join(", ")}`);
  const port = Number(process.env.PORT ?? 8787);
  const demo = process.env.DAIZEE_DEMO !== "0"; // on by default for the local demo
  const origins = (process.env.DAIZEE_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const brain = demo ? brainFromEnv() : null;
  const tts = demo ? ttsFromEnv() : null;
  const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../../simulator/dist");
  const staticDir = existsSync(dist) ? dist : undefined;

  // STORE=firestore connects to the real DayZer0 app; the default is fictional in-memory data.
  let live: { store: Store; clock: ManualClock; defaultUser: string } | undefined;
  let auth: AuthConfig | undefined;
  let usersLine = "Demo users: maya (has history), sam (blank). Send header x-daizee-user to choose.";
  if (process.env.STORE === "firestore") {
    const clock = new ManualClock();
    const { store, settings } = await firestoreStoreFromEnv(process.env, clock);
    const names = [...settings.users.keys()];
    live = { store, clock, defaultUser: names[0] as string };
    // Real app data: every /mcp request must carry a DayZer0 Firebase ID token.
    auth = await firebaseAuthFromEnv(process.env, settings);
    usersLine = `Connected to the DayZer0 app: project ${settings.projectId}${settings.emulator ? " (EMULATOR)" : " (LIVE DATA)"}, users: ${names.join(", ")}. Demo time travel and reset are off.`;
    usersLine += auth.allowDemoHeader
      ? "\nAuth: Firebase ID token, or x-daizee-user (DEMO_MODE=1, local demo only)."
      : "\nAuth: Firebase ID token required (Authorization: Bearer). Set DEMO_MODE=1 to also allow x-daizee-user.";
  }
  const { handler } = buildApp({ demo, allowedOrigins: origins, brain, tts, staticDir, live, auth });

  createServer((req, res) => void handler(req, res)).listen(port, () => {
    console.log(`daizee-mcp listening on http://localhost:${port}/mcp  (demo controls ${demo ? "ON" : "off"})`);
    console.log(usersLine);
    console.log(brain ? `Assistant brain: Gemini (${brain.model})` : "Assistant brain: not configured (replay mode only)");
    console.log(tts ? `Assistant voice: Google Cloud Text-to-Speech (${tts.voice})` : "Assistant voice: the browser's own (set DAIZEE_TTS=google for a natural cloud voice)");
    console.log(staticDir ? `Demo page: http://localhost:${port}/` : "Demo page: not built yet (run npm run build:sim)");
  });
}

// Run only when started directly, not when imported by tests.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
