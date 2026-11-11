import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { LuluClient } from "./client.js";
import { LuluError } from "./errors.js";
import { TOOLS, type ToolDefinition } from "./tools.js";
import { VERSION } from "./version.js";

export const SERVER_NAME = "lulu-print";

function instructions(environment: string): string {
  return [
    `Tools for the Lulu Print API (print-on-demand books). Connected to Lulu's ${environment.toUpperCase()} environment.`,
    environment === "production"
      ? "PRODUCTION: create_print_job and reprint_print_job place real orders that can be charged to the account's card. Confirm with the user before calling them."
      : "SANDBOX: orders are test orders and are never printed or charged.",
    "Products are identified by a pod_package_id SKU such as '0600X0900.BW.STD.PB.060UW444.MXX'.",
    "Usual order flow: calculate_cover_dimensions -> validate_interior_file / validate_cover_file (poll until done) -> get_shipping_options -> calculate_print_job_cost -> create_print_job -> get_print_job_status.",
  ].join("\n");
}

/** Builds an MCP server exposing every Lulu Print API operation as a tool. */
export function createLuluServer(client: LuluClient): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: VERSION },
    { instructions: instructions(client.environment) },
  );
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        // Strict, so a misspelt field is an error instead of being silently dropped.
        inputSchema: z.strictObject(tool.inputSchema),
        annotations: { title: tool.title, ...tool.annotations },
      },
      (args: Record<string, unknown>) => runTool(client, tool, args),
    );
  }
  return server;
}

/** Runs one tool. Lulu errors come back as tool errors the model can read and act on. */
export async function runTool(
  client: LuluClient,
  tool: ToolDefinition,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  try {
    const result = await client.request(tool.buildRequest(args));
    const text =
      result === null
        ? "Done. Lulu returned no content."
        : typeof result === "string"
          ? result
          : JSON.stringify(result, null, 2);
    return { content: [{ type: "text", text }] };
  } catch (error) {
    if (error instanceof LuluError) {
      return { isError: true, content: [{ type: "text", text: error.message }] };
    }
    throw error;
  }
}
