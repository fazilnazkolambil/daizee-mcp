import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server/main.js";
import { MAX_SPOKEN_WORDS } from "../src/server/spoken.js";

function voiceSafe(spoken: string): void {
  expect(spoken.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(MAX_SPOKEN_WORDS);
  expect(spoken).not.toMatch(/[*_`#|>~]/);
  expect(spoken.length).toBeGreaterThan(0);
}

describe("get_today_plan (in-memory demo users)", () => {
  it("gives Maya her focus, the three steps and the afternoon nudge", async () => {
    const { service } = buildApp();
    const out = await service.todayPlan("maya");
    expect(out.hasPlan).toBe(true);
    expect(out.focus?.title).toBe("Protein at every meal");
    expect(out.plan).toMatchObject({ eat: expect.any(String), move: expect.any(String), recover: expect.any(String) });
    expect(out.afternoon?.headline).toBeTruthy();
    expect(out.spoken).toMatch(/^Your focus today: Protein at every meal\. Eat: .+ Move: .+ Recover: .+/);
    voiceSafe(out.spoken);
  });

  it("gives Sam a day-one plan with no afternoon nudge", async () => {
    const { service } = buildApp();
    const out = await service.todayPlan("sam");
    expect(out.afternoon).toBeNull();
    expect(out.spoken).not.toMatch(/afternoon/i);
    voiceSafe(out.spoken);
  });

  it("is read only: nothing about the day changes", async () => {
    const { service } = buildApp();
    const before = await service.dayProgress("maya");
    await service.todayPlan("maya");
    expect(await service.dayProgress("maya")).toEqual(before);
  });

  it("fails clearly for an unknown user", async () => {
    const { service } = buildApp();
    await expect(service.todayPlan("nobody")).rejects.toThrow(/Unknown demo user/);
  });
});
