/**
 * Voice in and out using the browser's own Web Speech API.
 * Note: in Chrome, speech recognition sends audio to Google's servers.
 * Typed input always works as a fallback.
 */

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function canListen(): boolean {
  return recognitionCtor() !== null;
}

/** Starts listening once. Returns a function that stops it. */
export function listen(handlers: { onText: (text: string) => void; onError: (message: string) => void; onEnd: () => void }): () => void {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    handlers.onError("This browser has no speech recognition. Please type instead.");
    handlers.onEnd();
    return () => undefined;
  }
  const rec = new Ctor();
  rec.lang = "en-IN";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    const text = e.results[0]?.[0]?.transcript?.trim();
    if (text) handlers.onText(text);
  };
  rec.onerror = (e) => handlers.onError(e.error === "not-allowed" ? "Microphone permission was denied." : `Voice input problem: ${e.error ?? "unknown"}`);
  rec.onend = handlers.onEnd;
  rec.start();
  return () => rec.stop();
}

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
