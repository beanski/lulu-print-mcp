import { describe, expect, it } from "vitest";
import { TokenProvider } from "../src/auth.js";
import { LuluAuthError } from "../src/errors.js";
import { jsonResponse } from "./helpers.js";

const TOKEN_URL = "https://api.sandbox.lulu.com/auth/realms/glasstree/protocol/openid-connect/token";

function provider(respond: () => Response | Promise<Response>, now = () => 0) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const tokens = new TokenProvider({
    tokenUrl: TOKEN_URL,
    clientKey: "my-key",
    clientSecret: "my-secret",
    timeoutMs: 1000,
    now,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return respond();
    },
  });
  return { tokens, calls };
}

describe("TokenProvider", () => {
  it("uses the client-credentials grant with HTTP Basic auth", async () => {
    const { tokens, calls } = provider(() => jsonResponse({ access_token: "abc", expires_in: 3600 }));
    expect(await tokens.getToken()).toBe("abc");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(TOKEN_URL);
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get("authorization")).toBe(`Basic ${Buffer.from("my-key:my-secret").toString("base64")}`);
    expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(calls[0]!.init?.body).toBe("grant_type=client_credentials");
    expect(calls[0]!.init?.method).toBe("POST");
  });

  it("caches the token until a minute before it expires", async () => {
    let clock = 0;
    let issued = 0;
    const { tokens, calls } = provider(
      () => jsonResponse({ access_token: `t${++issued}`, expires_in: 300 }),
      () => clock,
    );
    expect(await tokens.getToken()).toBe("t1");
    clock = 239_000;
    expect(await tokens.getToken()).toBe("t1");
    clock = 240_000;
    expect(await tokens.getToken()).toBe("t2");
    expect(calls).toHaveLength(2);
  });

  it("shares one request between concurrent callers", async () => {
    const { tokens, calls } = provider(() => jsonResponse({ access_token: "abc", expires_in: 3600 }));
    const results = await Promise.all([tokens.getToken(), tokens.getToken(), tokens.getToken()]);
    expect(results).toEqual(["abc", "abc", "abc"]);
    expect(calls).toHaveLength(1);
  });

  it("fetches a new token after invalidate()", async () => {
    let issued = 0;
    const { tokens } = provider(() => jsonResponse({ access_token: `t${++issued}`, expires_in: 3600 }));
    await tokens.getToken();
    tokens.invalidate();
    expect(await tokens.getToken()).toBe("t2");
  });

  it("falls back to a five-minute lifetime when expires_in is missing", async () => {
    let clock = 0;
    let issued = 0;
    const { tokens } = provider(() => jsonResponse({ access_token: `t${++issued}` }), () => clock);
    await tokens.getToken();
    clock = 239_000;
    expect(await tokens.getToken()).toBe("t1");
    clock = 240_000;
    expect(await tokens.getToken()).toBe("t2");
  });

  it("explains rejected credentials without revealing them", async () => {
    const { tokens } = provider(() => jsonResponse({ error: "invalid_client" }, 401));
    const error = await tokens.getToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LuluAuthError);
    expect((error as LuluAuthError).status).toBe(401);
    expect(String(error)).toMatch(/sandbox and production use different keys/);
    expect(String(error)).not.toContain("my-secret");
    expect(String(error)).not.toContain("my-key");
  });

  it("reports other token server errors without the credentials hint", async () => {
    const { tokens } = provider(() => new Response("down", { status: 503 }));
    await expect(tokens.getToken()).rejects.toThrow(/^Lulu rejected the API credentials \(HTTP 503\)\.$/);
  });

  it("reports network failures", async () => {
    const { tokens } = provider(() => Promise.reject(new Error("getaddrinfo ENOTFOUND")));
    await expect(tokens.getToken()).rejects.toThrow(/Could not reach the Lulu login server: getaddrinfo ENOTFOUND/);
  });

  it.each([
    ["not JSON", () => new Response("<html>", { status: 200 }), /not JSON/],
    ["no token", () => jsonResponse({ expires_in: 10 }), /no access_token/],
    ["empty token", () => jsonResponse({ access_token: "" }), /no access_token/],
    ["a list", () => jsonResponse([]), /no access_token/],
  ])("rejects a token response that is %s", async (_label, respond, message) => {
    const { tokens } = provider(respond);
    await expect(tokens.getToken()).rejects.toThrow(message);
  });

  it("retries after a failed fetch instead of caching the failure", async () => {
    let first = true;
    const { tokens } = provider(() => {
      if (first) {
        first = false;
        return new Response("", { status: 500 });
      }
      return jsonResponse({ access_token: "ok" });
    });
    await expect(tokens.getToken()).rejects.toThrow();
    expect(await tokens.getToken()).toBe("ok");
  });
});
