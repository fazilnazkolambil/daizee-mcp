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
let cloudVoice = false;
let cloudFailures = 0;
let audio: HTMLAudioElement | null = null;
let stopCurrent: (() => void) | null = null;

/** True while a reply is being read aloud. */
export function isSpeaking(): boolean {
  return speaking;
}

/** Use the server's natural cloud voice (/brain/speak) when it has one. */
export function useCloudVoice(on: boolean): void {
  cloudVoice = on;
  cloudFailures = 0;
}

/**
 * Reads `text` aloud. Resolves when it has finished (or was stopped, or
 * nothing can speak), so the page knows when it may listen again. Uses the
 * cloud voice when available, else the browser's own; a watchdog resolves
 * anyway if the end is never reported.
 */
export async function speak(text: string): Promise<void> {
  stopSpeaking();
  if (!text) return;
  speaking = true;
  let finished = false;
  const done = (): void => {
    finished = true;
  };
  stopCurrent = done;
  if (cloudVoice && cloudFailures < 3) {
    try {
      await playCloud(text, () => finished);
      cloudFailures = 0;
      if (stopCurrent === done) speaking = false;
      return;
    } catch {
      cloudFailures++; // after three failures in a row, stay on the browser voice
      if (finished) return; // stopped while fetching
    }
  }
  await speakInBrowser(text);
  if (stopCurrent === done) speaking = false;
}

async function playCloud(text: string, stopped: () => boolean): Promise<void> {
  const res = await fetch("/brain/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  if (!res.ok) throw new Error(`voice HTTP ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  if (stopped()) {
    URL.revokeObjectURL(url);
    return;
  }
  const el = new Audio(url);
  audio = el;
  try {
    await new Promise<void>((resolve, reject) => {
      const watchdog = setTimeout(resolve, 60_000);
      const end = (): void => {
        clearTimeout(watchdog);
        resolve();
      };
      el.onended = end;
      el.onpause = end; // stopSpeaking() pauses it
      el.onerror = () => {
        clearTimeout(watchdog);
        reject(new Error("audio playback failed"));
      };
      el.play().catch((err: unknown) => {
        clearTimeout(watchdog);
        reject(err instanceof Error ? err : new Error("autoplay blocked"));
      });
    });
  } finally {
    if (audio === el) audio = null;
    URL.revokeObjectURL(url);
  }
}

function speakInBrowser(text: string): Promise<void> {
  if (!("speechSynthesis" in window)) return Promise.resolve();
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) utter.voice = voice;
  utter.lang = voice?.lang ?? "en-IN";
  utter.rate = 1.03;
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
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
  stopCurrent?.();
  stopCurrent = null;
  if (audio) {
    audio.pause();
    audio = null;
  }
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
