import { describe, expect, it } from "vitest";
import { Brain } from "../src/brain/gemini.js";
import { MAX_AUDIO_BYTES, TRANSCRIBE_INSTRUCTION, buildInstruction, hasSpeechEnergy, parseWav, transcribe } from "../src/brain/transcribe.js";
import { encodeWav } from "../simulator/src/wav.js";

/** A loud-enough tone: passes the silence gate, so the model is actually called. */
function tone(seconds: number): Buffer {
  const rate = 16_000;
  const samples = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < samples.length; i++) samples[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / rate);
  return Buffer.from(encodeWav(samples, rate));
}

describe("the browser's WAV encoder and the server's validator agree", () => {
  it("accepts a recording at the browser's own 18 s cap", () => {
    const wav = tone(18);
    expect(wav.length).toBeLessThanOrEqual(MAX_AUDIO_BYTES);
    const info = parseWav(wav);
    expect(info.seconds).toBeCloseTo(18, 1);
    expect(hasSpeechEnergy(wav.subarray(info.dataOffset, info.dataOffset + info.dataBytes))).toBe(true);
  });

  it("accepts a typical 3 s recording", () => {
    expect(() => parseWav(tone(3))).not.toThrow();
  });
});

describe("transcription vocabulary hint", () => {
  it("leaves the plain instruction alone when there is no vocabulary", () => {
    expect(buildInstruction([])).toBe(TRANSCRIBE_INSTRUCTION);
  });

  it("lists the service's words once each, lower-cased, and forbids guessing", () => {
    const text = buildInstruction(["Pad Thai", "pad thai", "idli", " Dosa "]);
    expect(text).toContain("pad thai, idli, dosa");
    expect(text.match(/pad thai/g)).toHaveLength(1);
    expect(text).toMatch(/never replace a spoken word/i);
  });

  it("caps how many words it sends", () => {
    const many = Array.from({ length: 500 }, (_, i) => `word${i}`);
    const text = buildInstruction(many);
    expect(text).toContain("word159");
    expect(text).not.toContain("word160");
  });

  it("sends the vocabulary to the model with the audio", async () => {
    let sent: { contents: Array<{ parts: Array<{ text?: string; inlineData?: unknown }> }> } | null = null;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Log pad thai for dinner." }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const brain = new Brain({ apiKey: "k", model: "m", fetchImpl });
    const text = await transcribe(brain, tone(2), ["pad thai", "idli"]);
    expect(text).toBe("Log pad thai for dinner.");
    const parts = (sent as unknown as { contents: Array<{ parts: Array<{ text?: string; inlineData?: unknown }> }> }).contents[0]?.parts ?? [];
    expect(parts[0]?.text).toContain("pad thai, idli");
    expect(parts[1]?.inlineData).toBeDefined();
  });
});
