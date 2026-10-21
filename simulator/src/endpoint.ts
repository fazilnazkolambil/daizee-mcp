/**
 * End-of-speech detection for hands-free voice: decides, from the recorder's
 * 0..1 level readings, when the person has started talking and when they have
 * stopped. Pure (no DOM, no audio), so it is tested with made-up level traces.
 *
 * The thresholds follow the room: a running noise floor (quick to fall, slow
 * to rise) means a steady fan or hum does not count as speech, and speech
 * itself does not drag the floor up.
 */

export type EndpointState = "listening" | "speaking" | "end" | "no-speech";

export interface EndpointOptions {
  /** After speech, this much continuous quiet ends the turn. */
  silenceMs: number;
  /** With no speech at all for this long, give up ("no-speech"). Omit to wait forever. */
  noSpeechMs?: number;
  /** Loud for at least this long before it counts as speech (ignores clicks and bumps). Default 150. */
  minSpeechMs?: number;
}

/** Levels are RMS x 4, clamped to 0..1: talking at a laptop is roughly 0.1 to 0.4. */
const SPEECH_MIN = 0.09;
const QUIET_MIN = 0.05;

export class EndpointDetector {
  private floor = Number.NaN;
  private loudMs = 0;
  private quietMs = 0;
  private elapsedMs = 0;
  private heard = false;
  private done: EndpointState | null = null;

  constructor(private readonly opts: EndpointOptions) {}

  /** True once the person has said something. */
  get heardSpeech(): boolean {
    return this.heard;
  }

  /** Feed one level reading taken `dtMs` after the previous one. */
  feed(level: number, dtMs: number): EndpointState {
    if (this.done) return this.done;
    const dt = Number.isFinite(dtMs) && dtMs > 0 ? Math.min(dtMs, 250) : 0;
    const v = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
    this.elapsedMs += dt;

    if (Number.isNaN(this.floor)) this.floor = v;
    else if (v < this.floor) this.floor += (v - this.floor) * 0.3;
    else if (!this.heard || v < this.speechThreshold()) this.floor += (v - this.floor) * 0.002;

    if (v >= this.speechThreshold()) {
      this.loudMs += dt;
      this.quietMs = 0;
      if (this.loudMs >= (this.opts.minSpeechMs ?? 150)) this.heard = true;
    } else if (v < this.quietThreshold()) {
      if (this.heard) this.quietMs += dt;
      else this.loudMs = Math.max(0, this.loudMs - dt);
    } else if (this.heard) {
      this.quietMs = 0; // between the two thresholds: still talking softly
    }

    if (this.heard && this.quietMs >= this.opts.silenceMs) return (this.done = "end");
    if (!this.heard && this.opts.noSpeechMs !== undefined && this.elapsedMs >= this.opts.noSpeechMs) return (this.done = "no-speech");
    return this.heard ? "speaking" : "listening";
  }

  private speechThreshold(): number {
    return Math.max(SPEECH_MIN, this.floor * 2.5 + 0.03);
  }

  private quietThreshold(): number {
    return Math.max(QUIET_MIN, this.floor * 1.6 + 0.02);
  }
}
