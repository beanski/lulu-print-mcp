import { describe, expect, it } from "vitest";
import { LuluClient } from "../src/client.js";
import { LuluApiError, LuluAuthError, LuluNetworkError } from "../src/errors.js";
import { VERSION } from "../src/version.js";
import { fakeLulu, jsonResponse, makeClient, testConfig } from "./helpers.js";

describe("LuluClient", () => {
  it("uses the sandbox or production host", () => {
    expect(makeClient(fakeLulu()).baseUrl).toBe("https://api.sandbox.lulu.com");
    const prod = makeClient(fakeLulu(), {}, { environment: "production" });
    expect(prod.baseUrl).toBe("https://api.lulu.com");
    expect(prod.environment).toBe("production");
  });

  it("gets its token from the matching host", async () => {
    const fake = fakeLulu();
    await makeClient(fake, {}, { environment: "production" }).request({ method: "GET", path: "/webhooks/" });
    expect(fake.tokenRequests[0]!.url.href).toBe(
      "https://api.lulu.com/auth/realms/glasstree/protocol/openid-connect/token",
    );
  });

  it("sends the bearer token, JSON headers and a User-Agent", async () => {
    const fake = fakeLulu();
    await makeClient(fake).request({ method: "POST", path: "/webhooks/", body: { a: 1 } });
    const { headers, rawBody } = fake.requests[0]!;
    expect(headers.get("authorization")).toBe("Bearer token-1");
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("user-agent")).toBe(`lulu-print-mcp/${VERSION}`);
    expect(rawBody).toBe('{"a":1}');
  });

  it("sends no body or content type when there is no body", async () => {
    const fake = fakeLulu();
    await makeClient(fake).request({ method: "GET", path: "/webhooks/" });
    expect(fake.requests[0]!.rawBody).toBeUndefined();
    expect(fake.requests[0]!.headers.get("content-type")).toBeNull();
  });

  it("encodes query values and skips undefined ones", async () => {
    const fake = fakeLulu();
    await makeClient(fake).request({
      method: "GET",
      path: "/print-jobs/",
      query: { page: 2, exclude_line_items: false, search: "a&b c", status: undefined },
    });
    const url = fake.requests[0]!.url;
    expect(url.pathname).toBe("/print-jobs/");
    expect([...url.searchParams]).toEqual([
      ["page", "2"],
      ["exclude_line_items", "false"],
      ["search", "a&b c"],
    ]);
  });

  it("reuses one token across requests", async () => {
    const fake = fakeLulu();
    const client = makeClient(fake);
    await client.request({ method: "GET", path: "/webhooks/" });
    await client.request({ method: "GET", path: "/webhooks/" });
    expect(fake.tokenRequests).toHaveLength(1);
  });

  it("returns parsed JSON, text, or null for an empty body", async () => {
    const responses = [
      jsonResponse({ id: 1 }),
      new Response("queued", { status: 200, headers: { "content-type": "text/plain" } }),
      new Response(null, { status: 204 }),
      new Response("{broken", { status: 200, headers: { "content-type": "application/json" } }),
    ];
    const client = makeClient(fakeLulu(() => responses.shift()!));
    expect(await client.request({ method: "GET", path: "/a/" })).toEqual({ id: 1 });
    expect(await client.request({ method: "GET", path: "/a/" })).toBe("queued");
    expect(await client.request({ method: "DELETE", path: "/a/" })).toBeNull();
    expect(await client.request({ method: "GET", path: "/a/" })).toBe("{broken");
  });

  it("turns error responses into LuluApiError with Lulu's message", async () => {
    const body = { shipping_address: { postcode: ["This field is required."] } };
    const client = makeClient(fakeLulu(() => jsonResponse(body, 400)));
    const error = await client.request({ method: "POST", path: "/print-jobs/", body: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LuluApiError);
    expect(error).toMatchObject({ status: 400, method: "POST", path: "/print-jobs/", body });
    expect((error as Error).message).toContain("This field is required.");
  });

  it("truncates very long error bodies and handles empty ones", async () => {
    const responses = [new Response("x".repeat(10_000), { status: 500 }), new Response("", { status: 404 })];
    const client = makeClient(fakeLulu(() => responses.shift()!));
    const long = (await client.request({ method: "POST", path: "/a/" }).catch((e: unknown) => e)) as Error;
    expect(long.message.length).toBeLessThan(4200);
    expect(long.message).toMatch(/truncated\)$/);
    await expect(client.request({ method: "POST", path: "/a/" })).rejects.toThrow(/\(empty response body\)/);
  });

  it("refreshes the token once after a 401, then gives up", async () => {
    const statuses = [401, 200];
    const fake = fakeLulu(() => jsonResponse({}, statuses.shift() ?? 401));
    const client = makeClient(fake);
    await client.request({ method: "POST", path: "/print-jobs/", body: {} });
    expect(fake.tokenRequests).toHaveLength(2);
    expect(fake.requests[1]!.headers.get("authorization")).toBe("Bearer token-2");

    const always401 = makeClient(fakeLulu(() => jsonResponse({ detail: "nope" }, 401)));
    await expect(always401.request({ method: "GET", path: "/a/" })).rejects.toMatchObject({ status: 401 });
  });

  it("retries GETs on 429/502/503/504, honouring Retry-After", async () => {
    const waits: number[] = [];
    const responses = [
      jsonResponse({}, 429, { "retry-after": "3" }),
      jsonResponse({}, 503),
      jsonResponse({ ok: true }),
    ];
    const fake = fakeLulu(() => responses.shift()!);
    const client = makeClient(fake, { sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    } });
    expect(await client.request({ method: "GET", path: "/a/" })).toEqual({ ok: true });
    expect(waits).toEqual([3000, 1500]);
  });

  it("caps Retry-After and stops after two retries", async () => {
    const waits: number[] = [];
    const fake = fakeLulu(() => jsonResponse({}, 502, { "retry-after": "999" }));
    const client = makeClient(fake, { sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    } });
    await expect(client.request({ method: "GET", path: "/a/" })).rejects.toMatchObject({ status: 502 });
    expect(fake.requests).toHaveLength(3);
    expect(waits).toEqual([10_000, 10_000]);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"] as const)("never retries a %s on a server error", async (method) => {
    const fake = fakeLulu(() => jsonResponse({}, 503));
    await expect(makeClient(fake).request({ method, path: "/a/" })).rejects.toBeInstanceOf(LuluApiError);
    expect(fake.requests).toHaveLength(1);
  });

  it("retries GETs after network errors", async () => {
    let calls = 0;
    const fake = fakeLulu(() => {
      calls++;
      if (calls < 3) throw new TypeError("fetch failed");
      return jsonResponse({ ok: true });
    });
    expect(await makeClient(fake).request({ method: "GET", path: "/a/" })).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it("warns that a failed POST may have gone through, and doesn't retry it", async () => {
    let calls = 0;
    const fake = fakeLulu(() => {
      calls++;
      throw new TypeError("socket hang up");
    });
    const error = (await makeClient(fake)
      .request({ method: "POST", path: "/print-jobs/", body: {} })
      .catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(LuluNetworkError);
    expect(error.message).toMatch(/socket hang up.*may or may not have reached Lulu/);
    expect(calls).toBe(1);
  });

  it("gives up on GET network errors after two retries", async () => {
    const fake = fakeLulu(() => {
      throw new TypeError("fetch failed");
    });
    await expect(makeClient(fake).request({ method: "GET", path: "/a/" })).rejects.toThrow(
      /^Could not reach Lulu for GET \/a\/: fetch failed\.$/,
    );
  });

  it("times out slow requests", async () => {
    const fake = fakeLulu();
    const slowFetch = async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("/auth/")) return fake.fetch(url, init);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => { reject(init.signal!.reason as Error); });
      });
    };
    const client = new LuluClient({ ...testConfig, timeoutMs: 20 }, { fetch: slowFetch, sleep: () => Promise.resolve() });
    await expect(client.request({ method: "POST", path: "/a/" })).rejects.toThrow(/timeout|aborted/i);
  });

  it.each(["GET", "POST"] as const)("reports bad keys as a login error on %s, without sending or retrying", async (method) => {
    let tokenCalls = 0;
    let apiCalls = 0;
    const fetch = (url: string | URL) => {
      if (String(url).includes("/auth/")) {
        tokenCalls++;
        return Promise.resolve(jsonResponse({ error: "invalid_client" }, 401));
      }
      apiCalls++;
      return Promise.resolve(jsonResponse({}));
    };
    const error = (await makeClient({ fetch })
      .request({ method, path: "/print-jobs/" })
      .catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(LuluAuthError);
    expect(error.message).not.toMatch(/may or may not|Could not reach Lulu for/);
    expect(tokenCalls).toBe(1);
    expect(apiCalls).toBe(0);
  });

  it("ends network error messages with a single full stop", async () => {
    const fake = fakeLulu(() => {
      throw new Error("connection reset.");
    });
    await expect(makeClient(fake).request({ method: "GET", path: "/a/" })).rejects.toThrow(
      /^Could not reach Lulu for GET \/a\/: connection reset\.$/,
    );
  });

  it("treats a failure while reading the response like a network error", async () => {
    const brokenBody = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("The operation was aborted due to timeout"));
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const post = await makeClient(fakeLulu(brokenBody))
      .request({ method: "POST", path: "/print-jobs/", body: {} })
      .catch((e: unknown) => e as Error);
    expect(post).toBeInstanceOf(LuluNetworkError);
    expect((post as Error).message).toMatch(/aborted due to timeout.*may or may not have reached Lulu/);

    const responses = [brokenBody(), jsonResponse({ ok: true })];
    expect(await makeClient(fakeLulu(() => responses.shift()!)).request({ method: "GET", path: "/a/" })).toEqual({ ok: true });
  });

  it("works with the default fetch and sleep", () => {
    expect(new LuluClient(testConfig).baseUrl).toBe("https://api.sandbox.lulu.com");
  });
});
