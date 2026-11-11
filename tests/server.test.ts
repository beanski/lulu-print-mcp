/** End to end through the MCP protocol, as Claude or another MCP client would use it. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";
import { createLuluServer, runTool } from "../src/server.js";
import { TOOLS } from "../src/tools.js";
import { VERSION } from "../src/version.js";
import { FIXTURES } from "./fixtures.js";
import { fakeLulu, jsonResponse, makeClient, type Handler } from "./helpers.js";

async function connect(handler?: Handler, environment: "sandbox" | "production" = "sandbox") {
  const fake = fakeLulu(handler);
  const server = createLuluServer(makeClient(fake, {}, { environment }));
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, fake };
}

const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as { type: string; text: string }[])[0]!.text;

describe("MCP server", () => {
  it("lists every tool with its schema and annotations", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    for (const listed of tools) {
      const tool = TOOLS.find((t) => t.name === listed.name)!;
      expect(listed.description).toBe(tool.description);
      expect(listed.inputSchema.type).toBe("object");
      expect(listed.annotations).toMatchObject({ title: tool.title, ...tool.annotations });
    }
    const create = tools.find((t) => t.name === "create_print_job")!;
    expect(create.inputSchema.required).toEqual(
      expect.arrayContaining(["contact_email", "shipping_level", "shipping_address", "line_items"]),
    );
  });

  it("reports its name, version and environment", async () => {
    const { client } = await connect();
    expect(client.getServerVersion()).toEqual({ name: "lulu-print", version: VERSION });
    expect(client.getInstructions()).toMatch(/SANDBOX: orders are test orders/);
    const prod = await connect(undefined, "production");
    expect(prod.client.getInstructions()).toMatch(/PRODUCTION: .*Confirm with the user/);
  });

  it.each(TOOLS.map((t) => t.name))("%s works end to end", async (name) => {
    const { client, fake } = await connect(() => jsonResponse({ id: 99, name }));
    const result = await client.callTool({ name, arguments: FIXTURES[name]!.maximal });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toEqual({ id: 99, name });
    expect(fake.requests).toHaveLength(1);
  });

  it("returns Lulu's error to the model as a tool error", async () => {
    const { client } = await connect(() => jsonResponse({ detail: "Not found." }, 404));
    const result = await client.callTool({ name: "get_print_job", arguments: { id: "1" } });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('Lulu API returned HTTP 404 for GET /print-jobs/1/: {"detail":"Not found."}');
  });

  it("rejects invalid arguments without calling Lulu", async () => {
    const { client, fake } = await connect();
    const result = await client.callTool({ name: "get_print_job", arguments: { id: "../webhooks" } });
    expect(result.isError).toBe(true);
    expect(fake.requests).toHaveLength(0);
  });

  it("reports a cross-field input error without calling Lulu", async () => {
    const { client, fake } = await connect();
    const result = await client.callTool({ name: "update_webhook", arguments: { id: "abc" } });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/at least one of url, topics or is_active/);
    expect(fake.requests).toHaveLength(0);
  });

  it("says when Lulu returns no content, and passes text through", async () => {
    const responses = [new Response(null, { status: 204 }), new Response("sent", { status: 200 })];
    const { client } = await connect(() => responses.shift()!);
    const deleted = await client.callTool({ name: "delete_webhook", arguments: { id: "abc" } });
    expect(text(deleted)).toBe("Done. Lulu returned no content.");
    const tested = await client.callTool({
      name: "test_webhook",
      arguments: { id: "abc", topic: "PRINT_JOB_STATUS_CHANGED" },
    });
    expect(text(tested)).toBe("sent");
  });

  it("rethrows unexpected errors instead of hiding them", async () => {
    const client = makeClient(fakeLulu());
    const broken = { ...TOOLS[0]!, buildRequest: () => { throw new TypeError("bug"); } };
    await expect(runTool(client, broken, {})).rejects.toThrow("bug");
  });
});

describe("package", () => {
  it("keeps VERSION in step with package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  it("exports the public API", () => {
    for (const name of ["LuluClient", "TokenProvider", "createLuluServer", "loadConfig", "TOOLS", "LuluApiError"]) {
      expect(api).toHaveProperty(name);
    }
  });
});
