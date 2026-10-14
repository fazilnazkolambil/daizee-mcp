import { describe, expect, it } from "vitest";
import {
  MAX_WAV_BYTES,
  MIME_PREFERENCE,
  TARGET_SAMPLE_RATE,
  WAV_HEADER_BYTES,
  downmixToMono,
  durationMs,
  encodeWav,
  levelFromTimeDomain,
  parseWav,
  peakLevel,
  pickMimeType,
  resampleLinear,
  smoothLevel,
} from "../simulator/src/wav.js";

const ascii = (bytes: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(start, start + length));

const viewOf = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function sine(frequency: number, sampleRate: number, seconds: number, amplitude = 0.8): Float32Array {
  const out = new Float32Array(Math.round(sampleRate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  return out;
}

/** Power of one frequency in a signal (Goertzel). Used to check a tone survived resampling. */
function powerAt(signal: Float32Array, frequency: number, sampleRate: number): number {
  const w = (2 * Math.PI * frequency) / sampleRate;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < signal.length; i++) {
    const s = (signal[i] as number) + coeff * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return (s1 * s1 + s2 * s2 - coeff * s1 * s2) / signal.length;
}

describe("encodeWav: header", () => {
  it("writes a canonical 44-byte RIFF/WAVE header for 16 kHz mono 16-bit PCM", () => {
    const wav = encodeWav(new Float32Array(3), 16000);
    expect(wav.length).toBe(44 + 6);
    const v = viewOf(wav);
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(v.getUint32(4, true)).toBe(36 + 6); // file size minus the 8 bytes of "RIFF" + this field
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(ascii(wav, 12, 4)).toBe("fmt ");
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000); // byte rate
    expect(v.getUint16(32, true)).toBe(2); // block align
    expect(v.getUint16(34, true)).toBe(16); // bits per sample
    expect(ascii(wav, 36, 4)).toBe("data");
    expect(v.getUint32(40, true)).toBe(6);
  });

  it("scales the rate fields with the sample rate", () => {
    const v = viewOf(encodeWav(new Float32Array(1), 44100));
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(28, true)).toBe(88200);
  });

  it("makes a valid header-only file for empty input", () => {
    const wav = encodeWav(new Float32Array(0), TARGET_SAMPLE_RATE);
    expect(wav.length).toBe(WAV_HEADER_BYTES);
    const v = viewOf(wav);
    expect(v.getUint32(4, true)).toBe(36);
    expect(v.getUint32(40, true)).toBe(0);
    expect(durationMs(wav)).toBe(0);
  });

  it("handles odd sample counts: the data size is always an even number of bytes", () => {
    for (const n of [1, 3, 5, 15999]) {
      const wav = encodeWav(new Float32Array(n), 16000);
      expect(wav.length).toBe(44 + n * 2);
      expect(viewOf(wav).getUint32(40, true)).toBe(n * 2);
      expect(viewOf(wav).getUint32(4, true)).toBe(wav.length - 8);
    }
  });

  it("rejects sample rates that cannot go in a header", () => {
    expect(() => encodeWav(new Float32Array(1), 0)).toThrow(RangeError);
    expect(() => encodeWav(new Float32Array(1), -16000)).toThrow(RangeError);
    expect(() => encodeWav(new Float32Array(1), 16000.5)).toThrow(RangeError);
    expect(() => encodeWav(new Float32Array(1), Number.NaN)).toThrow(RangeError);
  });

  it("fits the backend's body limit for the longest recording the page allows (18 s)", () => {
    expect(encodeWav(new Float32Array(18 * 16000), 16000).length).toBeLessThan(MAX_WAV_BYTES);
  });
});

describe("encodeWav: samples", () => {
  it("writes little-endian signed 16-bit values", () => {
    const wav = encodeWav(Float32Array.of(0, 0.5, -0.5, 1, -1), 16000);
    const v = viewOf(wav);
    const at = (i: number) => v.getInt16(44 + i * 2, true);
    expect(at(0)).toBe(0);
    expect(at(1)).toBe(Math.round(0.5 * 32767)); // 16384
    expect(at(2)).toBe(-16384);
    expect(at(3)).toBe(32767);
    expect(at(4)).toBe(-32768);
    // Little endian: 0x4000 is stored low byte first.
    expect(wav[44 + 2]).toBe(0x00);
    expect(wav[44 + 3]).toBe(0x40);
    // -32768 = 0x8000: low byte 0x00, high byte 0x80.
    expect(wav[44 + 8]).toBe(0x00);
    expect(wav[44 + 9]).toBe(0x80);
  });

  it("clips anything outside -1..1 and turns NaN into silence", () => {
    const wav = encodeWav(Float32Array.of(2.5, -7, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN), 16000);
    const v = viewOf(wav);
    const at = (i: number) => v.getInt16(44 + i * 2, true);
    expect(at(0)).toBe(32767);
    expect(at(1)).toBe(-32768);
    expect(at(2)).toBe(32767);
    expect(at(3)).toBe(-32768);
    expect(at(4)).toBe(0);
  });

  it("keeps a quiet signal quiet (no clipping, no offset)", () => {
    const wav = encodeWav(Float32Array.of(0.001, -0.001), 16000);
    const v = viewOf(wav);
    expect(v.getInt16(44, true)).toBe(33);
    expect(v.getInt16(46, true)).toBe(-33);
  });

  it("works on a view into a larger buffer", () => {
    const big = Float32Array.of(9, 9, 0.5, -0.5, 9);
    const wav = encodeWav(big.subarray(2, 4), 16000);
    expect(wav.length).toBe(48);
    expect(viewOf(wav).getInt16(44, true)).toBe(16384);
    expect(viewOf(wav).getInt16(46, true)).toBe(-16384);
  });
});

describe("parseWav and durationMs", () => {
  it("reports one second for 16000 samples at 16 kHz", () => {
    expect(durationMs(encodeWav(new Float32Array(16000), 16000))).toBe(1000);
  });

  it("reports the right length for other durations and rates", () => {
    expect(durationMs(encodeWav(new Float32Array(8000), 16000))).toBe(500);
    expect(durationMs(encodeWav(new Float32Array(44100 * 2), 44100))).toBeCloseTo(2000, 6);
    expect(durationMs(encodeWav(new Float32Array(1), 16000))).toBeCloseTo(0.0625, 6);
  });

  it("reads the header it wrote", () => {
    const info = parseWav(encodeWav(new Float32Array(10), 16000));
    expect(info).toEqual({ format: 1, channels: 1, sampleRate: 16000, bitsPerSample: 16, dataBytes: 20, dataOffset: 44 });
  });

  it("works on a subarray of a bigger buffer", () => {
    const wav = encodeWav(new Float32Array(1600), 16000);
    const padded = new Uint8Array(wav.length + 10);
    padded.set(wav, 7);
    expect(durationMs(padded.subarray(7, 7 + wav.length))).toBe(100);
  });

  it("skips extra chunks before the data chunk", () => {
    const wav = encodeWav(new Float32Array(160), 16000);
    const extra = Uint8Array.of(...Array.from("LIST", (c) => c.charCodeAt(0)), 3, 0, 0, 0, 1, 2, 3, 0); // 3 bytes + 1 pad
    const withList = new Uint8Array(wav.length + extra.length);
    withList.set(wav.subarray(0, 36), 0);
    withList.set(extra, 36);
    withList.set(wav.subarray(36), 36 + extra.length);
    expect(durationMs(withList)).toBe(10);
  });

  it("only counts the audio that is actually there when the header claims more", () => {
    const wav = encodeWav(new Float32Array(1600), 16000);
    expect(durationMs(wav.subarray(0, 44 + 1600))).toBe(50); // half the audio
    expect(parseWav(wav.subarray(0, 44 + 1600))?.dataBytes).toBe(1600);
  });

  it("returns 0 for anything that is not a WAV", () => {
    expect(durationMs(new Uint8Array(0))).toBe(0);
    expect(durationMs(new Uint8Array(100))).toBe(0);
    expect(durationMs(new TextEncoder().encode("RIFF....AVI LIST"))).toBe(0);
    expect(durationMs(encodeWav(new Float32Array(10), 16000).subarray(0, 30))).toBe(0);
    expect(parseWav(new Uint8Array(0))).toBeNull();
  });
});

describe("downmixToMono", () => {
  it("averages two channels", () => {
    const out = downmixToMono([Float32Array.of(1, 0, -1, 0.5), Float32Array.of(0, 0, 1, -0.5)]);
    expect(Array.from(out)).toEqual([0.5, 0, 0, 0]);
  });

  it("averages more than two channels", () => {
    const out = downmixToMono([Float32Array.of(0.3), Float32Array.of(0.6), Float32Array.of(0.9)]);
    expect(out[0]).toBeCloseTo(0.6, 6);
  });

  it("returns a copy for one channel, not the same array", () => {
    const input = Float32Array.of(0.1, 0.2, 0.3);
    const out = downmixToMono([input]);
    expect(Array.from(out)).toEqual(Array.from(input));
    out[0] = 9;
    expect(input[0]).toBeCloseTo(0.1, 6);
  });

  it("handles no channels, empty channels, and odd lengths", () => {
    expect(downmixToMono([]).length).toBe(0);
    expect(downmixToMono([new Float32Array(0), new Float32Array(0)]).length).toBe(0);
    expect(downmixToMono([new Float32Array(3).fill(1), new Float32Array(3).fill(0)]).length).toBe(3);
  });

  it("cuts channels of unequal length to the shortest", () => {
    const out = downmixToMono([Float32Array.of(1, 1, 1, 1), Float32Array.of(0, 0)]);
    expect(Array.from(out)).toEqual([0.5, 0.5]);
  });
});

describe("resampleLinear", () => {
  it("returns a copy at the same rate", () => {
    const input = Float32Array.of(0.1, -0.2, 0.3);
    const out = resampleLinear(input, 16000, 16000);
    expect(Array.from(out)).toEqual(Array.from(input));
    expect(out).not.toBe(input);
  });

  it("gives empty output for empty input", () => {
    expect(resampleLinear(new Float32Array(0), 48000, 16000).length).toBe(0);
    expect(resampleLinear(new Float32Array(0), 8000, 16000).length).toBe(0);
  });

  it("produces the right length for common rates", () => {
    expect(resampleLinear(new Float32Array(48000), 48000, 16000).length).toBe(16000);
    expect(resampleLinear(new Float32Array(44100), 44100, 16000).length).toBe(16000);
    expect(resampleLinear(new Float32Array(24000), 24000, 16000).length).toBe(16000);
    expect(resampleLinear(new Float32Array(8000), 8000, 16000).length).toBe(16000);
    expect(resampleLinear(new Float32Array(480), 48000, 16000).length).toBe(160);
  });

  it("copes with odd lengths and tiny inputs", () => {
    expect(resampleLinear(new Float32Array(7), 48000, 16000).length).toBe(2); // 7 / 3 rounds to 2
    expect(resampleLinear(new Float32Array(1), 48000, 16000).length).toBe(1);
    expect(resampleLinear(new Float32Array(3), 8000, 16000).length).toBe(6);
    for (const n of [1, 2, 3, 5, 99, 1001]) {
      for (const [from, to] of [[48000, 16000], [44100, 16000], [8000, 16000], [16000, 44100]] as const) {
        const out = resampleLinear(new Float32Array(n).fill(0.25), from, to);
        expect(out.length).toBeGreaterThan(0);
        expect(Array.from(out).every((x) => Math.abs(x - 0.25) < 1e-6)).toBe(true); // a constant stays constant
      }
    }
  });

  it("averages the input it covers when going down by a big factor", () => {
    const out = resampleLinear(Float32Array.of(1, 1, 1, -1, -1, -1, 0, 0, 0), 48000, 16000);
    expect(out.length).toBe(3);
    // Interior output sample 1 is centred on input 3 and covers inputs 2, 3, 4.
    expect(out[1]).toBeCloseTo((1 - 1 - 1) / 3, 5);
    expect(out[0]).toBeCloseTo(1, 5); // the edge window is cut to inputs 0 and 1
  });

  it("interpolates linearly when going up", () => {
    const out = resampleLinear(Float32Array.of(0, 1, 0), 8000, 16000);
    expect(Array.from(out).map((x) => Math.round(x * 100) / 100)).toEqual([0, 0.5, 1, 0.5, 0, 0]);
  });

  it("stays within the input's range and never produces NaN", () => {
    const noise = new Float32Array(5000);
    let seed = 12345;
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      noise[i] = (seed / 0xffffffff) * 2 - 1;
    }
    for (const [from, to] of [[48000, 16000], [44100, 16000], [22050, 16000], [8000, 16000]] as const) {
      const out = resampleLinear(noise, from, to);
      for (const x of out) {
        expect(Number.isFinite(x)).toBe(true);
        expect(Math.abs(x)).toBeLessThanOrEqual(1.0000001);
      }
    }
  });

  it("rejects rates that make no sense", () => {
    expect(() => resampleLinear(new Float32Array(1), 0, 16000)).toThrow(RangeError);
    expect(() => resampleLinear(new Float32Array(1), 48000, -1)).toThrow(RangeError);
    expect(() => resampleLinear(new Float32Array(1), Number.NaN, 16000)).toThrow(RangeError);
    expect(() => resampleLinear(new Float32Array(1), 48000, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("does not change the input", () => {
    const input = sine(440, 48000, 0.05);
    const before = Array.from(input);
    resampleLinear(input, 48000, 16000);
    expect(Array.from(input)).toEqual(before);
  });
});

describe("resampleLinear: a sine wave survives 48000 -> 16000", () => {
  for (const frequency of [220, 440, 1000, 3000]) {
    it(`keeps ${frequency} Hz at the same pitch, level and phase`, () => {
      const down = resampleLinear(sine(frequency, 48000, 1), 48000, 16000);
      expect(down.length).toBe(16000);

      // Compared with the sine sampled directly at 16 kHz (ignoring the edges), the error is small.
      const reference = sine(frequency, 16000, 1);
      let worst = 0;
      for (let i = 10; i < down.length - 10; i++) worst = Math.max(worst, Math.abs((down[i] as number) - (reference[i] as number)));
      expect(worst).toBeLessThan(frequency >= 3000 ? 0.06 : 0.01);

      // The energy is at the right frequency, and not at its neighbours.
      const at = powerAt(down, frequency, 16000);
      expect(at).toBeGreaterThan(powerAt(down, frequency * 1.1, 16000) * 50);
      expect(at).toBeGreaterThan(powerAt(down, frequency * 0.9, 16000) * 50);
    });
  }

  it("measures the same frequency by counting zero crossings", () => {
    const down = resampleLinear(sine(440, 48000, 1), 48000, 16000);
    let crossings = 0;
    for (let i = 1; i < down.length; i++) if ((down[i - 1] as number) < 0 && (down[i] as number) >= 0) crossings++;
    expect(Math.abs(crossings - 440)).toBeLessThanOrEqual(1);
  });

  it("keeps the amplitude of a speech-range tone close to the original", () => {
    const down = resampleLinear(sine(1000, 48000, 1, 0.8), 48000, 16000);
    expect(peakLevel(down)).toBeGreaterThan(0.77);
    expect(peakLevel(down)).toBeLessThanOrEqual(0.8001);
  });

  it("also works from 44100 and back up from 8000", () => {
    const from44 = resampleLinear(sine(500, 44100, 1), 44100, 16000);
    expect(from44.length).toBe(16000);
    expect(powerAt(from44, 500, 16000)).toBeGreaterThan(powerAt(from44, 550, 16000) * 50);

    const up = resampleLinear(sine(300, 8000, 1), 8000, 16000);
    expect(up.length).toBe(16000);
    expect(powerAt(up, 300, 16000)).toBeGreaterThan(powerAt(up, 330, 16000) * 50);
  });

  it("reduces a tone above the new Nyquist limit instead of folding it back at full strength", () => {
    // 12 kHz cannot exist at a 16 kHz rate (limit 8 kHz). Averaging damps it.
    const down = resampleLinear(sine(12000, 48000, 0.5, 0.8), 48000, 16000);
    expect(peakLevel(down)).toBeLessThan(0.5);
  });

  it("round trip: resample, encode, parse back to the same samples", () => {
    const down = resampleLinear(sine(440, 48000, 0.5), 48000, 16000);
    const wav = encodeWav(down, 16000);
    expect(durationMs(wav)).toBe(500);
    const v = viewOf(wav);
    for (const i of [0, 1, 100, 4000, down.length - 1]) {
      expect(v.getInt16(44 + i * 2, true)).toBe(Math.round((down[i] as number) * 32767));
    }
  });
});

describe("recorder helpers", () => {
  it("picks the first preferred type the browser supports", () => {
    expect(pickMimeType(() => true)).toBe("audio/webm;codecs=opus");
    expect(pickMimeType((t) => t === "audio/mp4")).toBe("audio/mp4"); // Safari
    expect(pickMimeType((t) => t.startsWith("audio/ogg"))).toBe("audio/ogg;codecs=opus"); // Firefox without webm
    expect(pickMimeType((t) => t === "audio/webm")).toBe("audio/webm");
    expect(pickMimeType(() => false)).toBeUndefined();
    expect(MIME_PREFERENCE[0]).toBe("audio/webm;codecs=opus");
  });

  it("treats a throwing isTypeSupported as not supported", () => {
    expect(
      pickMimeType((t) => {
        if (t.startsWith("audio/webm")) throw new Error("nope");
        return t === "audio/mp4";
      }),
    ).toBe("audio/mp4");
    expect(
      pickMimeType(() => {
        throw new Error("no MediaRecorder");
      }),
    ).toBeUndefined();
  });

  it("measures loudness from analyser bytes (silence is 128)", () => {
    expect(levelFromTimeDomain(new Uint8Array(0))).toBe(0);
    expect(levelFromTimeDomain(new Uint8Array(512).fill(128))).toBe(0);
    const quiet = Uint8Array.from({ length: 512 }, (_, i) => 128 + (i % 2 ? 2 : -2));
    const loud = Uint8Array.from({ length: 512 }, (_, i) => 128 + (i % 2 ? 20 : -20));
    const clipped = Uint8Array.from({ length: 512 }, (_, i) => (i % 2 ? 255 : 0));
    expect(levelFromTimeDomain(quiet)).toBeGreaterThan(0);
    expect(levelFromTimeDomain(quiet)).toBeLessThan(levelFromTimeDomain(loud));
    expect(levelFromTimeDomain(loud)).toBeCloseTo((20 / 128) * 4, 5); // 0.625
    expect(levelFromTimeDomain(clipped)).toBe(1);
  });

  it("smooths a level: fast up, slow down, always within 0..1", () => {
    expect(smoothLevel(0, 1)).toBeCloseTo(0.6, 6);
    expect(smoothLevel(1, 0)).toBeCloseTo(0.85, 6);
    expect(smoothLevel(0.5, 0.5)).toBe(0.5);
    let level = 0;
    for (let i = 0; i < 100; i++) level = smoothLevel(level, 1);
    expect(level).toBeLessThanOrEqual(1);
    expect(level).toBeGreaterThan(0.999);
    for (let i = 0; i < 100; i++) level = smoothLevel(level, 0);
    expect(level).toBeGreaterThanOrEqual(0);
    expect(level).toBeLessThan(0.001);
    expect(smoothLevel(0.2, 5)).toBe(1);
    expect(smoothLevel(0.2, -5)).toBe(0);
  });

  it("finds the peak, and treats silence and empty input as 0", () => {
    expect(peakLevel(new Float32Array(0))).toBe(0);
    expect(peakLevel(new Float32Array(100))).toBe(0);
    expect(peakLevel(Float32Array.of(0.1, -0.7, 0.3))).toBeCloseTo(0.7, 6);
    expect(peakLevel(Float32Array.of(Number.NaN, 0.2))).toBeCloseTo(0.2, 6);
  });
});
