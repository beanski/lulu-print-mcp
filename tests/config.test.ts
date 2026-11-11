import { describe, expect, it } from "vitest";
import { DEFAULT_TIMEOUT_MS, loadConfig } from "../src/config.js";
import { LuluConfigError } from "../src/errors.js";

const keys = { LULU_CLIENT_KEY: "key", LULU_CLIENT_SECRET: "secret" };

describe("loadConfig", () => {
  it("defaults to the sandbox so nobody places a real order by accident", () => {
    expect(loadConfig(keys)).toEqual({
      clientKey: "key",
      clientSecret: "secret",
      environment: "sandbox",
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  });

  it("switches to production only when asked, in any case", () => {
    expect(loadConfig({ ...keys, LULU_ENVIRONMENT: " Production " }).environment).toBe("production");
  });

  it("trims keys", () => {
    expect(loadConfig({ LULU_CLIENT_KEY: " key\n", LULU_CLIENT_SECRET: "\tsecret " })).toMatchObject({ clientKey: "key", clientSecret: "secret" });
  });

  it.each([
    [{}, /LULU_CLIENT_KEY and LULU_CLIENT_SECRET/],
    [{ LULU_CLIENT_KEY: "key" }, /Missing LULU_CLIENT_SECRET\./],
    [{ LULU_CLIENT_SECRET: "secret", LULU_CLIENT_KEY: "  " }, /Missing LULU_CLIENT_KEY\./],
  ])("names missing keys %#", (env, message) => {
    expect(() => loadConfig(env)).toThrow(LuluConfigError);
    expect(() => loadConfig(env)).toThrow(message);
  });

  it("rejects an unknown environment", () => {
    expect(() => loadConfig({ ...keys, LULU_ENVIRONMENT: "staging" })).toThrow(/"sandbox" or "production"/);
  });

  it("reads a custom timeout and rejects a bad one", () => {
    expect(loadConfig({ ...keys, LULU_TIMEOUT_MS: "5000" }).timeoutMs).toBe(5000);
    expect(loadConfig({ ...keys, LULU_TIMEOUT_MS: "2147483647" }).timeoutMs).toBe(2147483647);
    expect(loadConfig({ ...keys, LULU_TIMEOUT_MS: "" }).timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    for (const bad of ["0", "-1", "1.5", "soon", "2147483648", "1e12"]) {
      expect(() => loadConfig({ ...keys, LULU_TIMEOUT_MS: bad })).toThrow(LuluConfigError);
    }
  });

  it("never includes the secret in an error", () => {
    try {
      loadConfig({ LULU_CLIENT_SECRET: "super-secret-value", LULU_ENVIRONMENT: "nope" });
    } catch (error) {
      expect(String(error)).not.toContain("super-secret-value");
    }
  });
});
