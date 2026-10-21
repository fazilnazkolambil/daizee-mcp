import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { BrainError } from "../src/brain/gemini.js";
import { CloudTts, ttsFromEnv, type TtsRequest } from "../src/brain/tts.js";
import { buildApp } from "../src/server/main.js";

function fakeGoogle(audio = "bXAz") {
  const calls: Array<{ url: string; body: any; project: string }> = [];
  const request: TtsRequest = async (url, body, project) => {
    calls.push({ url, body, project });
    return { audioContent: audio };
  };
  return { request, calls };
}

describe("CloudTts (the demo page's natural voice)", () => {
  it("asks Google for MP3 in the voice's own language, billed to the named project", async () => {
    const g = fakeGoogle();
    const tts = new CloudTts({ project: "demo-proj", voice: "en-IN-Chirp3-HD-Aoede", request: g.request });
    const audio = await tts.synthesize("  Logged your   dinner. ");
    expect(audio.toString()).toBe("mp3");
    expect(g.calls[0]?.project).toBe("demo-proj");
    expect(g.calls[0]?.body).toMatchObject({ input: { text: "Logged your dinner." }, voice: { languageCode: "en-IN", name: "en-IN-Chirp3-HD-Aoede" }, audioConfig: { audioEncoding: "MP3" } });
  });

  it("serves a repeated sentence from its cache", async () => {
    const g = fakeGoogle();
    const tts = new CloudTts({ project: "p", request: g.request });
    await tts.synthesize("Hi.");
    await tts.synthesize("Hi.");
    expect(g.calls).toHaveLength(1);
  });

  it("refuses empty or overlong text, and stops at the daily cap", async () => {
    const g = fakeGoogle();
    const tts = new CloudTts({ project: "p", request: g.request, dailyCap: 1 });
    await expect(tts.synthesize("   ")).rejects.toBeInstanceOf(BrainError);
    await expect(tts.synthesize("x".repeat(601))).rejects.toThrow(/600/);
    await tts.synthesize("One.");
    await expect(tts.synthesize("Two.")).rejects.toMatchObject({ status: 429 });
  });

  it("never forwards the provider's error", async () => {
    const tts = new CloudTts({ project: "p", request: async () => { throw new Error("403 secret details"); } });
    const err = (await tts.synthesize("Hi.").catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(BrainError);
    expect(err.message).not.toMatch(/secret/);
  });

  it("is off unless DAIZEE_TTS=google and a project is known", () => {
    expect(ttsFromEnv({})).toBeNull();
    expect(ttsFromEnv({ DAIZEE_TTS: "google" })).toBeNull();
    expect(ttsFromEnv({ DAIZEE_TTS: "google", DAIZEE_SECRETS_PROJECT: "p" })?.voice).toBe("en-IN-Chirp3-HD-Aoede");
    expect(ttsFromEnv({ DAIZEE_TTS: "google", GCLOUD_PROJECT: "p", DAIZEE_TTS_VOICE: "en-US-Chirp3-HD-Kore" })?.voice).toBe("en-US-Chirp3-HD-Kore");
  });
});

describe("POST /brain/speak", () => {
  async function serve(tts: CloudTts | null) {
    const { handler } = buildApp({ demo: true, tts });
    const server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    return { base, close: () => new Promise((ok) => server.close(ok)) };
  }

  it("returns MP3, reports the voice in /brain/status, and 503s with no voice set up", async () => {
    const on = await serve(new CloudTts({ project: "p", request: fakeGoogle().request }));
    const res = await fetch(`${on.base}/brain/speak`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Hello." }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("mp3");
    expect(((await (await fetch(`${on.base}/brain/status`)).json()) as { voice: string }).voice).toBe("en-IN-Chirp3-HD-Aoede");
    await on.close();

    const off = await serve(null);
    expect((await fetch(`${off.base}/brain/speak`, { method: "POST", body: "{}" })).status).toBe(503);
    expect(((await (await fetch(`${off.base}/brain/status`)).json()) as { voice: unknown }).voice).toBeNull();
    await off.close();
  });
});
