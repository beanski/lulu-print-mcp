#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LuluClient } from "./client.js";
import { loadConfig } from "./config.js";
import { LuluConfigError } from "./errors.js";
import { createLuluServer } from "./server.js";

// stdout carries the MCP protocol, so anything for humans goes to stderr.
async function main(): Promise<void> {
  const config = loadConfig();
  const server = createLuluServer(new LuluClient(config));
  await server.connect(new StdioServerTransport());
  console.error(`lulu-print-mcp running against Lulu ${config.environment}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof LuluConfigError ? `lulu-print-mcp: ${error.message}` : error);
  process.exit(1);
});
