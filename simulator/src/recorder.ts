/**
 * Microphone recorder for the demo page's voice input.
 *
 * Records with MediaRecorder (whatever format the browser supports), decodes
 * it with the Web Audio API, and returns a 16 kHz mono 16-bit WAV, which is
 * what POST /brain/transcribe expects. Works in any browser that has
 * getUserMedia + MediaRecorder + Web Audio on a secure page (https or
 * localhost). The pure parts (mono mix, resampling, WAV encoding, level maths)
 * live in wav.ts, where Node tests cover them.
 *
 * Usage:
 *
 *   import { canRecord, startRecording, RecorderError } from "./recorder.js";
 *
 *   if (!canRecord()) { ...hide the mic button, typing only... }
 *
 *   let rec: Recording | undefined;
 *   async function onMicClick() {
 *     if (rec) { rec.stop(); return; }                       // second click = done speaking
 *     try {
 *       rec = await startRecording({ onLevel: (l) => pulse(l) });   // l is 0..1, ~60 times a second
 *       showListening();                                      // the mic is live from here
 *       const wav = await rec.done;                           // 16 kHz mono WAV (Uint8Array)
 *       const res = await fetch("/brain/transcribe", {
 *         method: "POST",
 *         headers: { "content-type": "application/octet-stream" },
 *         body: wav,
 *       });
 *       ...read { text } or { error, message }...
 *     } catch (err) {
 *       // err.code: unsupported | permission-denied | no-microphone | too-short | failed
 *       // err.message is plain English that can be shown to the user as it is.
 *       showMessage(err instanceof RecorderError ? err.message : "Voice input failed.");
 *     } finally {
 *       rec = undefined;                                      // the mic is already released by now
 *     }
 *   }
 *
 *   rec.stop()    finish and return what was said (also happens by itself after maxMs, default 12 s)
 *   rec.cancel()  throw the audio away; `done` rejects with RecorderError("failed", "Recording cancelled.")
 *                 (expected, so ignore that rejection in your own cancel handler)
 *
 * Whatever happens (success, cancel, error, auto-stop, unplugged microphone),
 * every media track is stopped and the AudioContext is closed before `done`
 * settles, so the browser's recording indicator turns off.
 */

import { EndpointDetector } from "./endpoint.js";
import {
  MAX_WAV_BYTES,
  TARGET_SAMPLE_RATE,
  WAV_HEADER_BYTES,
  downmixToMono,
  encodeWav,
  levelFromTimeDomain,
  peakLevel,
  pickMimeType,
  resampleLinear,
  smoothLevel,
} from "./wav.js";

export type RecorderErrorCode = "unsupported" | "permission-denied" | "no-microphone" | "too-short" | "no-speech" | "failed";

export class RecorderError extends Error {
  readonly code: RecorderErrorCode;

  constructor(code: RecorderErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RecorderError";
    this.code = code;
  }
}

export interface Recording {
  /** Stop listening and start processing. Safe to call more than once. */
  stop(): void;
  /** Discard everything and release the microphone. Safe to call at any time. */
  cancel(): void;
  /** The recording as a 16 kHz mono 16-bit WAV, or a RecorderError. */
  done: Promise<Uint8Array<ArrayBuffer>>;
}

export interface RecordingOptions {
  /** Stop by itself after this long. Default 12000, never more than 18000 (the backend's limit). */
  maxMs?: number;
  /** Anything shorter is rejected with "too-short". Default 400. */
  minMs?: number;
  /** Called about 60 times a second while recording with a smooth 0..1 loudness, then once with 0. */
  onLevel?: (level: number) => void;
  /** Hands-free: stop by itself after this much quiet once the person has spoken. Needs the level meter (onLevel). */
  endOnSilenceMs?: number;
  /** Hands-free: if nobody speaks for this long, give up with a "no-speech" error. Needs onLevel. */
  noSpeechMs?: number;
}

const DEFAULT_MAX_MS = 12_000;
const DEFAULT_MIN_MS = 400;
/** The backend refuses bodies over 600000 bytes (about 18.7 s of 16 kHz audio). */
const MAX_RECORDING_MS = 18_000;
// 18 s, matching the server's limit (it accepts up to 18.5 s and 600000 bytes).
const MAX_SAMPLES = Math.min(Math.floor((MAX_WAV_BYTES - WAV_HEADER_BYTES) / 2), 18 * 16_000);
/** Below this peak (about -60 dBFS) the microphone delivered silence. */
const SILENCE_PEAK = 0.001;
/** How long to wait for MediaRecorder to hand over its data after stop(). */
const STOP_WATCHDOG_MS = 4_000;
/** How often hands-free mode checks whether the person has stopped talking. */
const ENDPOINT_TICK_MS = 50;
/** How long decoding or resampling may take. */
const PROCESS_TIMEOUT_MS = 10_000;

const MESSAGES = {
  unsupported: "Voice input needs a recent browser and a secure (https) page. Please type instead.",
  permissionDenied: "Microphone access was blocked. Allow the microphone for this site in your browser settings, or type instead.",
  noMicrophone: "No microphone was found. Plug one in, or type instead.",
  busy: "The microphone is being used by another app. Close it and try again, or type instead.",
  tooShort: "That was too short. Please try again and speak a little longer.",
  silent: "No sound was picked up. Check that your microphone is not muted, then try again.",
  failed: "Something went wrong with the recording. Please try again, or type instead.",
  cancelled: "Recording cancelled.",
  timeout: "Processing the recording took too long. Please try again, or type instead.",
  noSpeech: "I didn't hear anything.",
} as const;

// ── feature detection ───────────────────────────────────────────────────────

type AudioContextCtor = typeof AudioContext;
type OfflineAudioContextCtor = typeof OfflineAudioContext;

function audioContextCtor(): AudioContextCtor | undefined {
  const w = globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext;
}

function offlineAudioContextCtor(): OfflineAudioContextCtor | undefined {
  const w = globalThis as unknown as { OfflineAudioContext?: OfflineAudioContextCtor; webkitOfflineAudioContext?: OfflineAudioContextCtor };
  return w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
}

function isSecurePage(): boolean {
  if (typeof window.isSecureContext === "boolean") return window.isSecureContext;
  const { protocol, hostname } = window.location;
  return protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** True when this page can record: secure page, microphone access, MediaRecorder and Web Audio. */
export function canRecord(): boolean {
  try {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    return (
      isSecurePage() &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof MediaRecorder !== "undefined" &&
      audioContextCtor() !== undefined
    );
  } catch {
    return false;
  }
}

// ── small helpers ───────────────────────────────────────────────────────────

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Runs something that may throw or return a promise that rejects, and ignores any failure. */
function swallow(fn: () => unknown): void {
  try {
    const result = fn();
    if (result && typeof (result as PromiseLike<unknown>).then === "function") {
      (result as PromiseLike<unknown>).then(undefined, () => undefined);
    }
  } catch {
    // Nothing useful to do: this is cleanup.
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RecorderError("failed", MESSAGES.timeout)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function mapMicrophoneError(err: unknown): RecorderError {
  const name = (err as { name?: string } | null)?.name;
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return new RecorderError("permission-denied", MESSAGES.permissionDenied, { cause: err });
    case "NotFoundError":
    case "DevicesNotFoundError":
      return new RecorderError("no-microphone", MESSAGES.noMicrophone, { cause: err });
    case "NotReadableError":
    case "TrackStartError":
      return new RecorderError("failed", MESSAGES.busy, { cause: err });
    default:
      return new RecorderError("failed", MESSAGES.failed, { cause: err });
  }
}

function toRecorderError(err: unknown): RecorderError {
  return err instanceof RecorderError ? err : new RecorderError("failed", MESSAGES.failed, { cause: err });
}

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the recording"));
    reader.readAsArrayBuffer(blob);
  });
}

/** decodeAudioData, whether this browser answers with a promise or with callbacks (older Safari). */
function decodeAudio(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    try {
      const maybePromise = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
      if (maybePromise && typeof maybePromise.then === "function") maybePromise.then(resolve, reject);
    } catch (err) {
      reject(err);
    }
  });
}

/** Resamples and mixes to mono with the browser's own (good quality) offline renderer. */
function renderOffline(audio: AudioBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    const Ctor = offlineAudioContextCtor();
    if (!Ctor) {
      reject(new Error("No OfflineAudioContext"));
      return;
    }
    try {
      const length = Math.max(1, Math.round((audio.length * TARGET_SAMPLE_RATE) / audio.sampleRate));
      // One channel in: the destination mixes stereo down to mono for us.
      const offline = new Ctor(1, length, TARGET_SAMPLE_RATE);
      const source = offline.createBufferSource();
      source.buffer = audio;
      source.connect(offline.destination);
      source.start(0);
      // Older Safari only has the event, newer browsers have the promise.
      offline.oncomplete = (event) => resolve(event.renderedBuffer);
      const maybePromise = offline.startRendering() as Promise<AudioBuffer> | undefined;
      if (maybePromise && typeof maybePromise.then === "function") maybePromise.then(resolve, reject);
    } catch (err) {
      reject(err);
    }
  });
}

/** Decoded audio to 16 kHz mono samples: offline renderer first, plain JavaScript if that fails. */
async function toMono16k(audio: AudioBuffer): Promise<Float32Array> {
  if (audio.sampleRate === TARGET_SAMPLE_RATE && audio.numberOfChannels === 1) return audio.getChannelData(0).slice();
  try {
    const rendered = await withTimeout(renderOffline(audio), PROCESS_TIMEOUT_MS);
    if (rendered.sampleRate === TARGET_SAMPLE_RATE && rendered.length > 0) return rendered.getChannelData(0).slice();
  } catch {
    // Fall back below.
  }
  const channels: Float32Array[] = [];
  for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c));
  return resampleLinear(downmixToMono(channels), audio.sampleRate, TARGET_SAMPLE_RATE);
}

// ── recording ───────────────────────────────────────────────────────────────

type Phase = "recording" | "stopping" | "processing" | "settled";

/**
 * Asks for the microphone and starts recording. Resolves once the microphone
 * is live. Rejects with a RecorderError if it cannot start (nothing is left
 * open in that case).
 */
export async function startRecording(opts: RecordingOptions = {}): Promise<Recording> {
  if (!canRecord()) throw new RecorderError("unsupported", MESSAGES.unsupported);

  const minMs = Math.max(0, Math.min(finiteOr(opts.minMs, DEFAULT_MIN_MS), MAX_RECORDING_MS));
  const maxMs = Math.min(Math.max(finiteOr(opts.maxMs, DEFAULT_MAX_MS), minMs, 1), MAX_RECORDING_MS);
  const onLevel = opts.onLevel;

  // Created now, still inside the click that started us: Safari only lets an
  // AudioContext run if it is made (or resumed) during a user gesture.
  const Ctor = audioContextCtor() as AudioContextCtor;
  let audioCtx: AudioContext | null;
  try {
    audioCtx = new Ctor();
  } catch (err) {
    throw new RecorderError("unsupported", MESSAGES.unsupported, { cause: err });
  }
  swallow(() => audioCtx?.resume());

  const closeContext = (): void => {
    const c = audioCtx;
    audioCtx = null;
    if (c && c.state !== "closed") swallow(() => c.close());
  };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (err) {
    closeContext();
    throw mapMicrophoneError(err);
  }

  // From here on the microphone is open: every exit path must go through release().
  let liveStream: MediaStream | null = stream;
  let recorder: MediaRecorder | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let frame = 0;
  let meterOn = false;
  let maxTimer: ReturnType<typeof setTimeout> | undefined;
  let endpointTimer: ReturnType<typeof setInterval> | undefined;
  /** Hands-free only: whether the end-of-speech detector ever heard talking. */
  let endpointOn = false;
  let heardSpeech = false;
  let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
  let phase: Phase = "recording";
  let startedAt = 0;
  const chunks: Blob[] = [];

  let resolveDone!: (wav: Uint8Array<ArrayBuffer>) => void;
  let rejectDone!: (err: RecorderError) => void;
  const done = new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  // A cancelled recording rejects on purpose: do not report that as unhandled.
  done.catch(() => undefined);

  const emitLevel = (level: number): void => {
    if (!onLevel) return;
    try {
      onLevel(level);
    } catch {
      // A bug in the page's animation must never stop the recording.
    }
  };

  const stopMeter = (): void => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (meterOn) {
      meterOn = false;
      emitLevel(0);
    }
  };

  /** Stops the microphone, the meter and the timers. The AudioContext stays open for decoding. */
  const releaseCapture = (): void => {
    clearTimeout(maxTimer);
    clearInterval(endpointTimer);
    clearTimeout(watchdogTimer);
    stopMeter();
    const src = source;
    source = null;
    analyser = null;
    if (src) swallow(() => src.disconnect());
    const s = liveStream;
    liveStream = null;
    if (s) {
      for (const track of s.getTracks()) {
        track.onended = null;
        swallow(() => track.stop());
      }
    }
  };

  const release = (): void => {
    releaseCapture();
    closeContext();
  };

  const detachRecorder = (): void => {
    const r = recorder;
    recorder = null;
    if (!r) return;
    r.ondataavailable = null;
    r.onerror = null;
    r.onstop = null;
    if (r.state !== "inactive") swallow(() => r.stop());
  };

  // A function, not a comparison, so TypeScript does not assume `phase` stays the same across awaits.
  const isSettled = (): boolean => phase === "settled";

  const succeed = (wav: Uint8Array<ArrayBuffer>): void => {
    if (phase === "settled") return;
    phase = "settled";
    release();
    resolveDone(wav);
  };

  const fail = (err: RecorderError): void => {
    if (phase === "settled") return;
    phase = "settled";
    detachRecorder();
    chunks.length = 0;
    release();
    rejectDone(err);
  };

  /** Everything after the recorder has handed over its data. */
  const processRecording = async (ctx: AudioContext, mimeType: string): Promise<void> => {
    try {
      const elapsedMs = performance.now() - startedAt;
      const blob = new Blob(chunks, { type: mimeType });
      chunks.length = 0;
      if (elapsedMs < minMs) throw new RecorderError("too-short", MESSAGES.tooShort);
      if (blob.size === 0) throw new RecorderError("failed", MESSAGES.failed);

      const data = await blobToArrayBuffer(blob);
      if (isSettled()) return; // cancelled while we were waiting
      const decoded = await withTimeout(decodeAudio(ctx, data), PROCESS_TIMEOUT_MS);
      if (isSettled()) return;
      let samples = await toMono16k(decoded);
      if (isSettled()) return;

      if (samples.length > MAX_SAMPLES) samples = samples.subarray(0, MAX_SAMPLES);
      if ((samples.length / TARGET_SAMPLE_RATE) * 1000 < minMs) throw new RecorderError("too-short", MESSAGES.tooShort);
      if (peakLevel(samples) < SILENCE_PEAK) throw new RecorderError("failed", MESSAGES.silent);
      succeed(encodeWav(samples, TARGET_SAMPLE_RATE));
    } catch (err) {
      fail(toRecorderError(err));
    }
  };

  const stop = (): void => {
    if (phase !== "recording") return;
    // Nobody spoke: never send room noise to be transcribed (the model invents
    // a plausible sentence from its word list instead of returning nothing).
    if (endpointOn && !heardSpeech) {
      fail(new RecorderError("no-speech", MESSAGES.noSpeech));
      return;
    }
    phase = "stopping";
    clearTimeout(maxTimer);
    stopMeter();
    // The recorder answers with its last data and a stop event. If it never
    // does, give up instead of leaving the microphone on.
    watchdogTimer = setTimeout(() => fail(new RecorderError("failed", MESSAGES.failed)), STOP_WATCHDOG_MS);
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } catch (err) {
      fail(toRecorderError(err));
    }
  };

  const cancel = (): void => {
    fail(new RecorderError("failed", MESSAGES.cancelled));
  };

  try {
    const ctx = audioCtx as AudioContext | null;
    if (!ctx) throw new Error("The audio context closed before recording started");
    swallow(() => ctx.resume()); // the permission prompt may have paused it

    const mimeType = pickMimeType((type) => MediaRecorder.isTypeSupported(type));
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 128_000 } : { audioBitsPerSecond: 128_000 });
    } catch {
      recorder = new MediaRecorder(stream); // some browsers refuse a type they claimed to support
    }
    const rec = recorder;

    rec.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    rec.onerror = () => fail(new RecorderError("failed", MESSAGES.failed));
    rec.onstop = () => {
      if (phase === "settled" || phase === "processing") return;
      phase = "processing";
      clearTimeout(watchdogTimer);
      releaseCapture(); // the browser's recording indicator goes off here
      void processRecording(ctx, rec.mimeType || mimeType || "audio/webm");
    };

    // Unplugged or revoked while recording: process what we have.
    for (const track of stream.getAudioTracks()) track.onended = () => stop();

    // The level meter is optional: if Web Audio cannot do it, recording still works.
    if (onLevel) {
      try {
        const node = ctx.createMediaStreamSource(stream);
        const probe = ctx.createAnalyser();
        probe.fftSize = 1024;
        node.connect(probe); // not connected to the speakers, so no feedback
        source = node;
        analyser = probe;
        const samples = new Uint8Array(probe.fftSize);
        let level = 0;
        const tick = (): void => {
          frame = 0;
          if (phase !== "recording" || !analyser) return;
          analyser.getByteTimeDomainData(samples);
          level = smoothLevel(level, levelFromTimeDomain(samples));
          emitLevel(level);
          frame = requestAnimationFrame(tick);
        };
        meterOn = true;
        frame = requestAnimationFrame(tick);

        // Hands-free end of speech runs on its own timer, not on animation
        // frames: those pause when the tab is hidden, and the turn must still end.
        if (opts.endOnSilenceMs !== undefined || opts.noSpeechMs !== undefined) {
          const endpoint = new EndpointDetector({ silenceMs: opts.endOnSilenceMs ?? Number.POSITIVE_INFINITY, noSpeechMs: opts.noSpeechMs });
          const buf = new Uint8Array(probe.fftSize);
          let heard = 0;
          let last = performance.now();
          endpointOn = true;
          endpointTimer = setInterval(() => {
            if (phase !== "recording" || !analyser) return clearInterval(endpointTimer);
            analyser.getByteTimeDomainData(buf);
            heard = smoothLevel(heard, levelFromTimeDomain(buf));
            const now = performance.now();
            const state = endpoint.feed(heard, now - last);
            last = now;
            heardSpeech = endpoint.heardSpeech;
            if (state === "end") {
              clearInterval(endpointTimer);
              stop();
            } else if (state === "no-speech") {
              clearInterval(endpointTimer);
              fail(new RecorderError("no-speech", MESSAGES.noSpeech));
            }
          }, ENDPOINT_TICK_MS);
        }
      } catch {
        meterOn = false;
      }
    }

    rec.start();
    startedAt = performance.now();
    maxTimer = setTimeout(stop, maxMs);
  } catch (err) {
    const failure = toRecorderError(err);
    fail(failure);
    throw failure;
  }

  return { stop, cancel, done };
}
