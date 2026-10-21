/**
 * Pure helpers for the spoken conversation (no DOM, so Node tests can import them).
 */

export interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
}

/**
 * Picks a clear English voice. Natural Indian-English voices first (the demo's
 * foods and names are Indian), then well-known clear voices, then any English
 * one. Returns undefined when the browser has none, so its default is used.
 */
const PREFERRED = [
  /^(rishi|veena|lekha|isha)\b/i, // Apple en-IN
  /microsoft (neerja|prabhat).*online/i, // Edge en-IN neural
  /google.*english.*india/i,
  /^samantha\b/i,
  /^(karen|daniel|moira|tessa|serena)\b/i,
  /microsoft (aria|jenny|guy|sonia|libby|natasha).*online/i,
  /^google (us|uk) english/i,
];
export function chooseVoice<V extends VoiceLike>(voices: readonly V[]): V | undefined {
  const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  for (const pattern of PREFERRED) {
    const hit = english.find((v) => pattern.test(v.name));
    if (hit) return hit;
  }
  return english.find((v) => /^en[-_]IN$/i.test(v.lang)) ?? english.find((v) => v.localService) ?? english[0];
}

/** "That's all", "stop", "bye"... ends hands-free conversation without sending anything. */
export function isGoodbye(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?,]+$/g, "");
  return /^(stop|cancel|never ?mind|that'?s (all|it)|no,? thanks?( you)?|no thank you|thanks?,? (that'?s all|bye)|ok,? bye|bye|goodbye|good night|i'?m done|nothing( else)?)$/.test(t);
}
