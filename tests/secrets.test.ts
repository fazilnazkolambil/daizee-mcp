import { describe, expect, it, vi } from "vitest";
import { loadSecrets } from "../src/server/secrets.js";

describe("loadSecrets", () => {
  it("does nothing without DAIZEE_SECRETS_PROJECT", async () => {
    const fetch = vi.fn();
    const env: NodeJS.ProcessEnv = {};
    expect(await loadSecrets(env, fetch)).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it("reads missing secrets from the named project", async () => {
    const fetch = vi.fn(async (project: string, name: string) => `${project}/${name}`);
    const env: NodeJS.ProcessEnv = { DAIZEE_SECRETS_PROJECT: "demo-proj" };
    expect(await loadSecrets(env, fetch)).toEqual(["GEMINI_API_KEY"]);
    expect(env.GEMINI_API_KEY).toBe("demo-proj/GEMINI_API_KEY");
  });

  it("keeps a value already in the environment", async () => {
    const fetch = vi.fn();
    const env: NodeJS.ProcessEnv = { DAIZEE_SECRETS_PROJECT: "demo-proj", GEMINI_API_KEY: "set" };
    expect(await loadSecrets(env, fetch)).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(env.GEMINI_API_KEY).toBe("set");
  });

  it("fails loudly with a fix when the secret can't be read", async () => {
    const env: NodeJS.ProcessEnv = { DAIZEE_SECRETS_PROJECT: "demo-proj" };
    await expect(loadSecrets(env, async () => { throw new Error("403"); })).rejects.toThrow(/application-default login.*403/s);
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });
});
