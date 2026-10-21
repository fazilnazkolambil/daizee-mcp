import { GoogleAuth } from "google-auth-library";
import { BrainError } from "./gemini.js";

/**
 * Natural spoken replies for the demo page: Google Cloud Text-to-Speech.
 *
 * Like the rest of src/brain/ this is the demo's stand-in for the assistant
 * side (a real Alexa+ device speaks with Alexa's own voice); the MCP server
 * never uses it. No API key: it signs in with Application Default
 * Credentials (the function's own service account when hosted, your
 * `gcloud auth application-default login` locally) and bills the named
 * project. Short replies only, a daily cap, and a small cache because the
 * demo repeats itself.
 */

export const DEFAULT_TTS_VOICE = "en-IN-Chirp3-HD-Aoede";
const MAX_CHARS = 600;
const CACHE_SIZE = 64;

export type TtsRequest = (url: string, body: unknown, project: string) => Promise<{ audioContent?: string }>;

export interface TtsOptions {
  /** The Google Cloud project that is billed (and must have the Text-to-Speech API enabled). */
  project: string;
  /** A Text-to-Speech voice name; its language code is taken from the name. */
  voice?: string;
  /** Hard cap on syntheses per UTC day, so a public demo cannot run up a bill. */
  dailyCap?: number;
  now?: () => number;
  /** Replaceable in tests. */
  request?: TtsRequest;
}

let auth: GoogleAuth | undefined;
const googleRequest: TtsRequest = async (url, body, project) => {
  auth ??= new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  // Bill this project, not whatever quota project the local login defaults to.
  client.quotaProjectId = project;
  const res = await client.request<{ audioContent?: string }>({ url, method: "POST", data: body, headers: { "x-goog-user-project": project } });
  return res.data;
};

export class CloudTts {
  readonly voice: string;
  private readonly cache = new Map<string, Buffer>();
  private dayStamp = "";
  private usedToday = 0;

  constructor(private readonly opts: TtsOptions) {
    this.voice = opts.voice?.trim() || DEFAULT_TTS_VOICE;
  }

  /** MP3 bytes for `text`. Throws BrainError with a plain-English message. */
  async synthesize(text: string): Promise<Buffer> {
    const clean = String(text ?? "").replace(/\s+/g, " ").trim();
    if (!clean) throw new BrainError("Nothing to say.", 400);
    if (clean.length > MAX_CHARS) throw new BrainError(`Replies are read aloud only up to ${MAX_CHARS} characters.`, 400);

    const hit = this.cache.get(clean);
    if (hit) {
      this.cache.delete(clean); // most recently used goes last
      this.cache.set(clean, hit);
      return hit;
    }
    this.checkCap();

    const languageCode = this.voice.split("-").slice(0, 2).join("-") || "en-IN";
    let data: { audioContent?: string };
    try {
      data = await (this.opts.request ?? googleRequest)(
        "https://texttospeech.googleapis.com/v1/text:synthesize",
        { input: { text: clean }, voice: { languageCode, name: this.voice }, audioConfig: { audioEncoding: "MP3", speakingRate: 1.05 } },
        this.opts.project,
      );
    } catch {
      // Never forward the provider's error body.
      throw new BrainError("The cloud voice is unavailable right now; using the browser's voice.", 502);
    }
    if (!data.audioContent) throw new BrainError("The cloud voice returned no audio; using the browser's voice.", 502);
    const audio = Buffer.from(data.audioContent, "base64");

    this.cache.set(clean, audio);
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value as string);
    return audio;
  }

  private checkCap(): void {
    const stamp = new Date((this.opts.now ?? Date.now)()).toISOString().slice(0, 10);
    if (stamp !== this.dayStamp) {
      this.dayStamp = stamp;
      this.usedToday = 0;
    }
    if (this.usedToday >= (this.opts.dailyCap ?? 500)) throw new BrainError("The demo's daily voice limit was reached; using the browser's voice.", 429);
    this.usedToday++;
  }
}

/**
 * DAIZEE_TTS=google turns it on. The billed project is DAIZEE_TTS_PROJECT,
 * else DAIZEE_SECRETS_PROJECT, else the hosting project. DAIZEE_TTS_VOICE
 * picks the voice.
 */
export function ttsFromEnv(env: NodeJS.ProcessEnv = process.env): CloudTts | null {
  if (env.DAIZEE_TTS?.trim().toLowerCase() !== "google") return null;
  const project = (env.DAIZEE_TTS_PROJECT || env.DAIZEE_SECRETS_PROJECT || env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || "").trim();
  if (!project) return null;
  return new CloudTts({ project, voice: env.DAIZEE_TTS_VOICE, dailyCap: Number(env.DAIZEE_TTS_DAILY_CAP) || 500 });
}
