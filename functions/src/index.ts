import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { Brain } from "../../src/brain/gemini.js";
import { buildApp } from "../../src/server/main.js";

/**
 * The hosted demo: ONE function that serves the MCP server (/mcp), the demo
 * controls (/demo/*) and the demo page's assistant brain (/brain/*).
 *
 * The Gemini key comes from Secret Manager (never from a file or the repo).
 * State lives in this instance's memory, so the function is capped at ONE
 * instance: every visitor sees the same fictional data, and "Reset demo"
 * puts it back. A restart also resets it.
 */

const geminiKey = defineSecret("GEMINI_API_KEY");

type Handler = ReturnType<typeof buildApp>["handler"];
let handler: Handler | null = null;

function getHandler(): Handler {
  if (handler) return handler;

  const project = process.env.GCLOUD_PROJECT ?? "";
  const origins = project ? [`https://${project}.web.app`, `https://${project}.firebaseapp.com`] : [];
  const key = geminiKey.value().trim();
  const brain = key
    ? new Brain({
        apiKey: key,
        model: process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite",
        dailyCap: Number(process.env.DAIZEE_BRAIN_DAILY_CAP) || 300,
      })
    : null;

  handler = buildApp({ demo: true, brain, allowedOrigins: origins }).handler;
  return handler;
}

export const api = onRequest(
  {
    region: "us-central1",
    secrets: [geminiKey],
    maxInstances: 1,
    minInstances: 0,
    memory: "256MiB",
    timeoutSeconds: 60,
    cors: false, // our own handler validates the Origin header (an MCP requirement)
  },
  (req, res) => getHandler()(req, res),
);
