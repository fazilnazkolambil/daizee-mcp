/**
 * Pure audio helpers for the demo page's voice input.
 *
 * No DOM, no Node-only APIs: this file typechecks under both the root
 * tsconfig (no DOM) and the simulator tsconfig (DOM), and is unit tested in
 * Node (tests/wav.test.ts). recorder.ts keeps all of its testable logic here.
 *
 * The page sends the backend a canonical RIFF/WAVE file: 44-byte header, PCM,
 * 16-bit little endian, mono, 16000 Hz.
 */

/** The sample rate the backend expects. */
export const TARGET_SAMPLE_RATE = 16_000;

/** Size of the canonical RIFF/WAVE header written by encodeWav. */
export const WAV_HEADER_BYTES = 44;

/** The largest WAV the backend accepts (POST /brain/transcribe body limit). */
export const MAX_WAV_BYTES = 600_000;

// ── mono, resample, encode ───────────────────────────────────────────────────

/**
 * Averages all channels into one. Always returns a new array. Channels of
 * unequal length are cut to the shortest. No channels gives an empty array.
 */
export function downmixToMono(channels: readonly Float32Array[]): Float32Array {
  const count = channels.length;
  if (count === 0) return new Float32Array(0);
  let length = Number.POSITIVE_INFINITY;
  for (const channel of channels) length = Math.min(length, channel.length);
  const out = new Float32Array(length);
  if (count === 1) {
    out.set((channels[0] as Float32Array).subarray(0, length));
    return out;
  }
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let c = 0; c < count; c++) sum += (channels[c] as Float32Array)[i] as number;
    out[i] = sum / count;
  }
  return out;
}

function assertRate(rate: number, name: string): void {
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError(`${name} must be a positive number, got ${rate}`);
}

/**
 * Converts audio from one sample rate to another. Always returns a new array.
 *
 * Going down, each output sample is the average of the input it covers (a box
 * filter, computed in O(n) from running sums), which also removes most of the
 * aliasing. Going up, it interpolates linearly between neighbours. Output
 * sample i sits at input position i * (fromRate / toRate), so the signal is
 * not shifted in time. Empty input gives empty output.
 */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  assertRate(fromRate, "fromRate");
  assertRate(toRate, "toRate");
  const n = input.length;
  if (n === 0) return new Float32Array(0);
  if (fromRate === toRate) return input.slice();

  const ratio = fromRate / toRate; // input samples per output sample
  const outLength = Math.max(1, Math.round(n / ratio));
  const out = new Float32Array(outLength);

  if (ratio > 1) {
    // Input sample k covers [k, k + 1). integral(y) is the area under the
    // signal from 0 to y, so a window's average is (area difference) / width.
    const prefix = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) prefix[i + 1] = (prefix[i] as number) + (input[i] as number);
    const integral = (y: number): number => {
      const k = Math.floor(y);
      return k >= n ? (prefix[n] as number) : (prefix[k] as number) + (y - k) * (input[k] as number);
    };
    const half = ratio / 2;
    for (let i = 0; i < outLength; i++) {
      const centre = i * ratio + 0.5;
      const lo = Math.max(0, centre - half);
      const hi = Math.min(n, centre + half);
      out[i] = hi > lo ? (integral(hi) - integral(lo)) / (hi - lo) : (input[Math.min(n - 1, Math.round(i * ratio))] as number);
    }
  } else {
    for (let i = 0; i < outLength; i++) {
      const pos = i * ratio;
      const k = Math.floor(pos);
      const a = input[Math.min(k, n - 1)] as number;
      const b = input[Math.min(k + 1, n - 1)] as number;
      out[i] = a + (b - a) * (pos - k);
    }
  }
  return out;
}

function toInt16(sample: number): number {
  let s = sample;
  if (Number.isNaN(s)) s = 0;
  s = s > 1 ? 1 : s < -1 ? -1 : s;
  return Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/**
 * Encodes mono samples (nominally -1..1) as a canonical WAV file: 44-byte
 * header, PCM, 16-bit little endian, one channel. Values outside -1..1 are
 * clipped and NaN becomes silence. Empty input gives a valid header-only file.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate * 2 > 0xffffffff) {
    throw new RangeError(`sampleRate must be a positive whole number, got ${sampleRate}`);
  }
  const dataBytes = samples.length * 2;
  if (dataBytes > 0xffffffff - (WAV_HEADER_BYTES - 8)) throw new RangeError("Too many samples for one WAV file");

  const out = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(out.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, WAV_HEADER_BYTES - 8 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate = rate * channels * 2
  view.setUint16(32, 2, true); // block align = channels * 2
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(WAV_HEADER_BYTES + i * 2, toInt16(samples[i] as number), true);
  }
  return out;
}

// ── reading a WAV back ───────────────────────────────────────────────────────

export interface WavInfo {
  /** 1 = PCM. */
  format: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  /** Bytes of audio actually present (cut to the file length if the header claims more). */
  dataBytes: number;
  /** Where the audio starts in the file. */
  dataOffset: number;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let text = "";
  for (let i = 0; i < length; i++) text += String.fromCharCode(view.getUint8(offset + i));
  return text;
}

/** Reads the header of a RIFF/WAVE file, walking its chunks. Null if it is not a WAV. */
export function parseWav(wav: Uint8Array): WavInfo | null {
  if (wav.length < 12) return null;
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") return null;

  let fmt: Pick<WavInfo, "format" | "channels" | "sampleRate" | "bitsPerSample"> | null = null;
  let pos = 12;
  while (pos + 8 <= wav.length) {
    const id = readAscii(view, pos, 4);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > wav.length) return null;
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!fmt) return null;
      return { ...fmt, dataBytes: Math.min(size, wav.length - body), dataOffset: body };
    }
    pos = body + size + (size & 1); // chunks are padded to an even size
  }
  return null;
}

/** Length of a WAV file's audio in milliseconds. 0 if it cannot be read as a WAV. */
export function durationMs(wav: Uint8Array): number {
  const info = parseWav(wav);
  if (!info || info.sampleRate <= 0 || info.channels <= 0 || info.bitsPerSample < 8) return 0;
  const bytesPerFrame = info.channels * (info.bitsPerSample >> 3);
  return (Math.floor(info.dataBytes / bytesPerFrame) / info.sampleRate) * 1000;
}

// ── small helpers shared with recorder.ts (kept here so Node can test them) ─

/** Preferred recording formats, best first. */
export const MIME_PREFERENCE = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"] as const;

/** The first preferred type the browser can record, or undefined to let it choose. */
export function pickMimeType(isSupported: (type: string) => boolean): string | undefined {
  for (const type of MIME_PREFERENCE) {
    try {
      if (isSupported(type)) return type;
    } catch {
      // A browser that throws for a type does not support it.
    }
  }
  return undefined;
}

/**
 * A 0..1 loudness from an AnalyserNode's byte time-domain data (silence is
 * 128). Normal speech lands around 0.2 to 0.7.
 */
export function levelFromTimeDomain(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    const x = ((bytes[i] as number) - 128) / 128;
    sum += x * x;
  }
  return Math.min(1, Math.sqrt(sum / bytes.length) * 4);
}

/** Moves a displayed level toward a new reading: quick to rise, slow to fall. Stays within 0..1. */
export function smoothLevel(previous: number, next: number, attack = 0.6, release = 0.15): number {
  const k = next > previous ? attack : release;
  const value = previous + (next - previous) * k;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** The largest absolute sample value (0 for empty input). */
export function peakLevel(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i] as number);
    if (v > peak) peak = v;
  }
  return peak;
}
