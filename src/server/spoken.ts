/**
 * Helpers for the short text a voice assistant can read aloud.
 * Rules we follow: plain sentences, no markdown or table characters, and at
 * most MAX_SPOKEN_WORDS words.
 */

export const MAX_SPOKEN_WORDS = 75;

/** Strips characters that sound wrong or look like formatting when read aloud. */
export function plain(text: string): string {
  return text
    .replace(/[*_`#|>~]/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Keeps at most `maxWords` words, ending on a sentence boundary when it can. */
export function clampWords(text: string, maxWords = MAX_SPOKEN_WORDS): string {
  const clean = plain(text);
  const words = clean.split(" ");
  if (words.length <= maxWords) return clean;
  const cut = words.slice(0, maxWords).join(" ");
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  if (lastStop > cut.length * 0.5) return cut.slice(0, lastStop + 1);
  return cut.replace(/[,;:\s]+$/, "") + ".";
}

export function spoken(...parts: Array<string | null | undefined | false>): string {
  return clampWords(parts.filter(Boolean).join(" "));
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "ends in 2 days" style wording for how long a memory has left. */
export function lifespan(expiresInDays: number): string {
  if (expiresInDays >= 300) return "for about a year";
  if (expiresInDays <= 0) return "until today";
  return `for ${plural(expiresInDays, "more day")}`;
}

export function round(n: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
