import { describe, expect, it } from "vitest";
import { EndpointDetector, type EndpointState } from "../simulator/src/endpoint.js";

const FRAME = 16; // about 60 readings a second, like the recorder

/** Feeds `ms` worth of a level (or a level function of time) and returns the last state. */
function play(d: EndpointDetector, ms: number, level: number | ((t: number) => number)): EndpointState {
  let state: EndpointState = "listening";
  for (let t = 0; t < ms; t += FRAME) state = d.feed(typeof level === "number" ? level : level(t), FRAME);
  return state;
}

describe("EndpointDetector (hands-free end of speech)", () => {
  it("ends after speech followed by the set amount of quiet", () => {
    const d = new EndpointDetector({ silenceMs: 900 });
    expect(play(d, 300, 0.01)).toBe("listening");
    expect(play(d, 1200, 0.25)).toBe("speaking");
    expect(play(d, 600, 0.01)).toBe("speaking"); // a pause between words is not the end
    expect(play(d, 400, 0.01)).toBe("end");
  });

  it("does not end during short pauses between words", () => {
    const d = new EndpointDetector({ silenceMs: 900 });
    play(d, 200, 0.01);
    const speech = (t: number) => (Math.floor(t / 500) % 2 === 0 ? 0.3 : 0.01); // 500 ms talk, 500 ms pause
    expect(play(d, 4000, speech)).toBe("speaking");
  });

  it("ignores a click or bump shorter than minSpeechMs", () => {
    const d = new EndpointDetector({ silenceMs: 600, noSpeechMs: 2000 });
    play(d, 200, 0.01);
    play(d, 64, 0.6); // a 64 ms knock on the desk
    expect(d.heardSpeech).toBe(false);
    expect(play(d, 2000, 0.01)).toBe("no-speech");
  });

  it("gives up with no-speech when nobody talks", () => {
    const d = new EndpointDetector({ silenceMs: 900, noSpeechMs: 5000 });
    expect(play(d, 4900, 0.02)).toBe("listening");
    expect(play(d, 200, 0.02)).toBe("no-speech");
  });

  it("follows a noisy room: a steady hum is not speech, talking over it is", () => {
    const d = new EndpointDetector({ silenceMs: 900, noSpeechMs: 6000 });
    expect(play(d, 3000, 0.12)).toBe("listening"); // fan noise, above the fixed minimum
    expect(play(d, 800, 0.5)).toBe("speaking");
    expect(play(d, 1000, 0.12)).toBe("end"); // back to the hum = quiet
  });

  it("never waits for speech forever when noSpeechMs is unset, and stays ended once ended", () => {
    const d = new EndpointDetector({ silenceMs: 300 });
    expect(play(d, 20_000, 0.01)).toBe("listening");
    play(d, 400, 0.3);
    expect(play(d, 400, 0.01)).toBe("end");
    expect(d.feed(0.9, FRAME)).toBe("end");
  });

  it("copes with bad readings", () => {
    const d = new EndpointDetector({ silenceMs: 300 });
    expect(d.feed(Number.NaN, FRAME)).toBe("listening");
    expect(d.feed(5, -1)).toBe("listening");
    expect(play(d, 400, 0.3)).toBe("speaking");
  });
});

describe("voice helpers", async () => {
  const { chooseVoice, isGoodbye } = await import("../simulator/src/talk.js");

  it("prefers a natural Indian-English voice, then well-known clear ones, then any English", () => {
    const v = (name: string, lang: string, localService = true) => ({ name, lang, localService });
    expect(chooseVoice([v("Alex", "en-US"), v("Rishi", "en-IN"), v("Samantha", "en-US")])?.name).toBe("Rishi");
    expect(chooseVoice([v("Alex", "en-US"), v("Samantha", "en-US"), v("Thomas", "fr-FR")])?.name).toBe("Samantha");
    expect(chooseVoice([v("Thomas", "fr-FR"), v("Some Voice", "en_GB")])?.name).toBe("Some Voice");
    expect(chooseVoice([v("Thomas", "fr-FR")])).toBeUndefined();
    expect(chooseVoice([])).toBeUndefined();
  });

  it("recognises ways of ending a spoken conversation, and nothing else", () => {
    for (const t of ["That's all.", "stop", "No thanks", "no, thank you", "Thanks, bye!", "goodbye", "I'm done", "never mind"]) expect(isGoodbye(t)).toBe(true);
    for (const t of ["Stop logging my weight", "That's all I ate today", "no", "yes, forget it", "I had two idlis"]) expect(isGoodbye(t)).toBe(false);
  });
});
