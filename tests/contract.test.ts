/**
 * Locks the tools to Lulu's OpenAPI spec (spec/openapi_public.yml):
 * every spec operation has exactly one tool, every request a tool sends is
 * valid against the spec, and the tools can send every writable field.
 */
import { describe, expect, it } from "vitest";
import { TOOLS } from "../src/tools.js";
import { FIXTURES } from "./fixtures.js";
import {
  bodyValidator,
  fakeLulu,
  findOperation,
  makeClient,
  parameters,
  parseInput,
  presentPaths,
  requestBodySchema,
  requestExamples,
  specOperations,
  writablePaths,
} from "./helpers.js";

/**
 * Writable spec fields a tool deliberately doesn't expose, and why.
 * Anything not listed here must be reachable through the tool.
 */
const NOT_EXPOSED: Record<string, Record<string, string>> = {
  create_print_job: {
    "line_items[].cover.source_url": "shorthand for printable_normalization.cover, which the tool sends instead",
    "line_items[].cover.source_md5_sum": "shorthand for printable_normalization.cover",
    "line_items[].interior.source_url": "shorthand for printable_normalization.interior",
    "line_items[].interior.source_md5_sum": "shorthand for printable_normalization.interior",
    "line_items[].printable_id": "re-orders use reprint_print_job",
  },
  reprint_print_job: {
    "line_items[].cover.source_url": "new files use create_print_job",
    "line_items[].cover.source_md5_sum": "new files use create_print_job",
    "line_items[].interior.source_url": "new files use create_print_job",
    "line_items[].interior.source_md5_sum": "new files use create_print_job",
    "line_items[].printable_normalization.cover.source_url": "new files use create_print_job",
    "line_items[].printable_normalization.cover.source_md5_sum": "new files use create_print_job",
    "line_items[].printable_normalization.cover.job_id": "new files use create_print_job",
    "line_items[].printable_normalization.interior.source_url": "new files use create_print_job",
    "line_items[].printable_normalization.interior.source_md5_sum": "new files use create_print_job",
    "line_items[].printable_normalization.interior.job_id": "new files use create_print_job",
  },
};

/**
 * Fields a tool sends that the spec's schema doesn't list, and the spec text
 * that documents them. See docs/spec-notes.md.
 */
type Evidence = "example" | "create-schema";
const DOCUMENTED_OUTSIDE_SCHEMA: Record<string, Record<string, Evidence>> = {
  create_print_job: {
    // Every request example and code sample in the spec puts pod_package_id here.
    "line_items[].printable_normalization.pod_package_id": "example",
    // 'Linen Wrap Foil' section and the 'Example Linen Wrap Book' request example.
    "line_items[].printable_normalization.foil_stamp_title_text": "example",
    "line_items[].printable_normalization.foil_stamp_author_text": "example",
  },
  reprint_print_job: {
    // Reprints are the same endpoint (POST /print-jobs/); the create schema
    // lists recipient_tax_id and the spec says it's required for BR, CL and MX.
    "shipping_address.recipient_tax_id": "create-schema",
  },
};

describe("spec coverage", () => {
  it("has exactly one tool per operation in the spec", () => {
    const fromSpec = specOperations()
      .map((op) => `${op.method} ${JSON.stringify(op.specPath)}`)
      .sort();
    const fromTools = TOOLS.map((t) => `${t.operation.method} ${JSON.stringify(t.operation.specPath)}`).sort();
    expect(fromTools).toEqual(fromSpec);
    expect(fromSpec).toHaveLength(22);
  });

  it("uses unique tool names in snake_case", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it("has a minimal and a maximal fixture for every tool", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(TOOLS.map((t) => t.name).sort());
  });

  it("marks only GET-style tools read-only and flags cancel/delete as destructive", () => {
    for (const tool of TOOLS) {
      if (tool.operation.method === "GET") expect(tool.annotations.readOnlyHint, tool.name).toBe(true);
      if (["PUT", "PATCH", "DELETE"].includes(tool.operation.method)) {
        expect(tool.annotations.readOnlyHint, tool.name).toBe(false);
      }
    }
    const destructive = TOOLS.filter((t) => t.annotations.destructiveHint).map((t) => t.name);
    expect(destructive.sort()).toEqual(["cancel_print_job", "delete_webhook"]);
    for (const name of ["create_print_job", "reprint_print_job"]) {
      const tool = TOOLS.find((t) => t.name === name)!;
      expect(tool.annotations.readOnlyHint).toBe(false);
      expect(tool.annotations.idempotentHint).toBe(false);
    }
  });
});

describe.each(TOOLS.map((tool) => [tool.name, tool] as const))("%s", (_name, tool) => {
  const op = findOperation(tool.operation.method, tool.operation.specPath);
  const fixture = FIXTURES[tool.name]!;

  async function send(input: Record<string, unknown>) {
    const fake = fakeLulu();
    await makeClient(fake).request(tool.buildRequest(parseInput(tool, input)));
    expect(fake.requests).toHaveLength(1);
    return fake.requests[0]!;
  }

  it.each(["minimal", "maximal"] as const)("sends a %s request that matches the spec", async (kind) => {
    const request = await send(fixture[kind]);

    // Method and path
    expect(request.method).toBe(op.method);
    const pathPattern = new RegExp(`^${op.path.replace(/\{\w+\}/g, "([^/]+)")}$`);
    const match = pathPattern.exec(request.url.pathname);
    expect(match, `${request.url.pathname} should match ${op.path}`).not.toBeNull();
    const pathParams = parameters(op, "path");
    pathParams.forEach((param, index) => {
      const value = decodeURIComponent(match![index + 1]!);
      if (param.schema?.type === "integer") expect(value).toMatch(/^\d+$/);
      expect(value.length).toBeGreaterThan(0);
    });

    // Query parameters are all declared in the spec, with the right types
    const declared = new Map(parameters(op, "query").map((p) => [p.name as string, p]));
    for (const [key, value] of request.url.searchParams) {
      const param = declared.get(key);
      expect(param, `query parameter ${key} is not in the spec`).toBeDefined();
      if (param!.schema?.type === "integer") expect(value).toMatch(/^\d+$/);
      if (param!.schema?.type === "boolean") expect(value).toMatch(/^(true|false)$/);
      if (param!.schema?.format === "uuid") expect(value).toMatch(/^[0-9a-f-]{36}$/i);
    }

    // Body is valid against the spec's request schema
    const validate = bodyValidator(op);
    if (validate) {
      const valid = validate(request.body);
      expect(validate.errors ?? [], JSON.stringify(request.body)).toEqual([]);
      expect(valid).toBe(true);
    } else if (op.method !== "PUT") {
      expect(request.rawBody).toBeUndefined();
    }
  });

  it("can send every writable field in the spec", async () => {
    const request = await send(fixture.maximal);
    const exempt = NOT_EXPOSED[tool.name] ?? {};

    const declaredQuery = parameters(op, "query").map((p) => p.name as string).sort();
    expect([...request.url.searchParams.keys()].sort()).toEqual(declaredQuery);

    const schema = requestBodySchema(op);
    if (!schema) return;
    const sent = new Set(presentPaths(request.body));
    const missing = writablePaths(schema).filter((path) => !sent.has(path) && !(path in exempt));
    expect(missing, "spec fields the tool cannot send").toEqual([]);
  });

  it("sends nothing the spec doesn't document", async () => {
    const request = await send(fixture.maximal);
    const schema = requestBodySchema(op);
    if (!schema) return;
    const allowed = new Set([...writablePaths(schema), ...Object.keys(DOCUMENTED_OUTSIDE_SCHEMA[tool.name] ?? {})]);
    const extra = presentPaths(request.body).filter((path) => !allowed.has(path));
    expect(extra, "fields not in the spec").toEqual([]);
  });
});

describe("exemption lists stay honest", () => {
  it("only exempt fields that really are in the spec", () => {
    for (const [name, paths] of Object.entries(NOT_EXPOSED)) {
      const tool = TOOLS.find((t) => t.name === name)!;
      const schema = requestBodySchema(findOperation(tool.operation.method, tool.operation.specPath));
      const writable = new Set(writablePaths(schema));
      for (const path of Object.keys(paths)) expect(writable.has(path), `${name}: ${path}`).toBe(true);
    }
  });

  it("only allow extra fields the spec really documents elsewhere", () => {
    const create = findOperation("POST", "/print-jobs/");
    const exampleKeys = new Set(requestExamples(create).flatMap((e) => presentPaths(e)));
    const createKeys = new Set(writablePaths(requestBodySchema(create)));
    for (const [name, paths] of Object.entries(DOCUMENTED_OUTSIDE_SCHEMA)) {
      for (const [path, evidence] of Object.entries(paths)) {
        const source = evidence === "example" ? exampleKeys : createKeys;
        expect(source.has(path), `${name}: ${path} (${evidence})`).toBe(true);
      }
    }
  });
});
