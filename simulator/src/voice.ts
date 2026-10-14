/**
 * Spoken replies use the browser's own speech synthesis.
 * (Voice INPUT no longer uses the browser's Web Speech recognition, which needs
 * Google's servers and fails on some networks. See recorder.ts and the
 * /brain/transcribe route instead.)
 */

export function speak(text: string): void {
  if (!("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-IN";
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking(): void {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
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
