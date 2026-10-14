import { DAY_MS, type Clock } from "./types.js";

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/**
 * A clock whose time can be moved forward. Used by the demo's "Advance time"
 * button so a viewer can watch a memory expire without waiting days.
 * It starts at real time and only ever moves forward.
 */
export class ManualClock implements Clock {
  private offsetMs = 0;

  constructor(private readonly base: Clock = new SystemClock()) {}

  now(): number {
    return this.base.now() + this.offsetMs;
  }

  advanceDays(days: number): number {
    if (!Number.isFinite(days) || days < 0) {
      throw new RangeError("advanceDays needs a non-negative number");
    }
    this.offsetMs += days * DAY_MS;
    return this.now();
  }

  get advancedDays(): number {
    return Math.round(this.offsetMs / DAY_MS);
  }

  /** Back to real time (used by the demo "reset" control). */
  reset(): void {
    this.offsetMs = 0;
  }
}
