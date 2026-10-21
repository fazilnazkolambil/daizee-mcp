/**
 * Spoken replies use the browser's own speech synthesis.
 * (Voice INPUT no longer uses the browser's Web Speech recognition, which needs
 * Google's servers and fails on some networks. See recorder.ts and the
 * /brain/transcribe route instead.)
 */

import { chooseVoice } from "./talk.js";

let chosen: SpeechSynthesisVoice | undefined;
function pickVoice(): SpeechSynthesisVoice | undefined {
  if (!("speechSynthesis" in window)) return undefined;
  chosen ??= chooseVoice(window.speechSynthesis.getVoices());
  return chosen;
}
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  // Voices load asynchronously in Chrome: pick again once they arrive.
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    chosen = chooseVoice(window.speechSynthesis.getVoices());
  });
}

let speaking = false;
/** True while a reply is being read aloud. */
export function isSpeaking(): boolean {
  return speaking;
}

/**
 * Reads `text` aloud. Resolves when it has finished (or was stopped, or the
 * browser cannot speak), so the page knows when it may listen again. A
 * watchdog resolves anyway if the browser never reports the end.
 */
export function speak(text: string): Promise<void> {
  if (!("speechSynthesis" in window) || !text) return Promise.resolve();
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) utter.voice = voice;
  utter.lang = voice?.lang ?? "en-IN";
  utter.rate = 1.03;
  speaking = true;
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      speaking = false;
      clearTimeout(watchdog);
      resolve();
    };
    // About 2.6 words a second, plus slack: never wait forever on a lost "end" event.
    const watchdog = setTimeout(finish, 3_000 + text.split(/\s+/).length * 450);
    utter.onend = finish;
    utter.onerror = finish;
    window.speechSynthesis.speak(utter);
  });
}

export function stopSpeaking(): void {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  speaking = false;
}

export interface TranscribeResult {
  text: string;
}

/** Sends a 16 kHz mono WAV to the demo backend, which asks Gemini to transcribe it. */
export async function transcribe(wav: Uint8Array): Promise<string> {
  const res = await fetch("/brain/transcribe", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: wav as unknown as BodyInit,
  });
  const body = (await res.json().catch(() => ({}))) as Partial<TranscribeResult> & { message?: string };
  if (!res.ok) throw new Error(body.message ?? `Voice transcription failed (HTTP ${res.status})`);
  return (body.text ?? "").trim();
}
