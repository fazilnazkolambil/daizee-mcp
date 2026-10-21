/**
 * Fast voice input with the browser's own speech recognition (Chrome, Edge,
 * Safari). Words appear while you talk and the final text is ready the moment
 * you stop, so there is no upload-then-transcribe wait. The browser decides
 * when you have finished speaking.
 *
 * It is not available everywhere and Chrome's needs Google's servers (some
 * networks block them), so the page falls back to recorder.ts + Gemini when
 * this is missing or fails with a network error.
 */

import { pickAlternative } from "./talk.js";

export type ListenErrorCode = "unsupported" | "no-speech" | "permission-denied" | "network" | "cancelled" | "failed";

export class ListenError extends Error {
  constructor(
    readonly code: ListenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ListenError";
  }
}

export interface Listening {
  /** Finish now and use what was heard so far. */
  stop(): void;
  /** Throw it away. `done` rejects with code "cancelled". */
  cancel(): void;
  /** The final text (never empty), or a ListenError. */
  done: Promise<string>;
}

export interface ListenOptions {
  lang?: string;
  /** The service's own words: among several guesses, the one using them wins ("ate 5 eggs" over "8 5 x"). */
  vocabulary?: readonly string[];
  /** Called with the words heard so far, while the person is talking. */
  onPartial?: (text: string) => void;
  /** Give up with "no-speech" if nothing is heard for this long. */
  noSpeechMs?: number;
}

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

function ctor(): RecognitionCtor | undefined {
  const w = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function canListen(): boolean {
  return typeof window !== "undefined" && Boolean(ctor()) && window.isSecureContext;
}

export function startListening(opts: ListenOptions = {}): Listening {
  const Ctor = ctor();
  if (!Ctor) throw new ListenError("unsupported", "This browser has no built-in speech recognition.");
  const rec = new Ctor();
  rec.lang = opts.lang ?? "en-IN";
  rec.interimResults = true;
  rec.continuous = false; // the browser ends the turn when the person stops talking
  rec.maxAlternatives = 5;

  let finalText = "";
  let partial = "";
  let error: ListenError | null = null;
  let cancelled = false;
  let resolveDone!: (t: string) => void;
  let rejectDone!: (e: ListenError) => void;
  const done = new Promise<string>((ok, no) => {
    resolveDone = ok;
    rejectDone = no;
  });
  done.catch(() => undefined);

  const noSpeechTimer =
    opts.noSpeechMs !== undefined
      ? setTimeout(() => {
          if (!finalText && !partial) {
            error = new ListenError("no-speech", "I didn't hear anything.");
            rec.abort();
          }
        }, opts.noSpeechMs)
      : undefined;

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (!r) continue;
      if (r.isFinal) {
        const guesses = Array.from({ length: r.length }, (_, k) => r[k]?.transcript ?? "").filter(Boolean);
        finalText += `${finalText ? " " : ""}${pickAlternative(guesses, opts.vocabulary ?? [])}`;
      } else interim += r[0]?.transcript ?? "";
    }
    partial = `${finalText} ${interim}`.trim();
    if (partial) opts.onPartial?.(partial);
  };
  rec.onerror = (e) => {
    const code: ListenErrorCode =
      e.error === "no-speech" ? "no-speech"
      : e.error === "not-allowed" || e.error === "service-not-allowed" ? "permission-denied"
      : e.error === "network" ? "network"
      : e.error === "aborted" ? (cancelled ? "cancelled" : "no-speech")
      : "failed";
    error ??= new ListenError(code, code === "no-speech" ? "I didn't hear anything." : `Speech recognition failed (${e.error}).`);
  };
  rec.onend = () => {
    clearTimeout(noSpeechTimer);
    const text = (finalText || partial).trim();
    if (cancelled) rejectDone(new ListenError("cancelled", "Listening cancelled."));
    else if (text) resolveDone(text);
    else rejectDone(error ?? new ListenError("no-speech", "I didn't hear anything."));
  };

  try {
    rec.start();
  } catch (err) {
    clearTimeout(noSpeechTimer);
    throw new ListenError("failed", err instanceof Error ? err.message : "Speech recognition could not start.");
  }

  return {
    stop: () => rec.stop(),
    cancel: () => {
      cancelled = true;
      rec.abort();
    },
    done,
  };
}
