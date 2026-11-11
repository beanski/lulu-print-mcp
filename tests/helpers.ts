import { readFileSync } from "node:fs";
import { Ajv, type ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";
import { parse } from "yaml";
import { z } from "zod";
import type { FetchLike } from "../src/auth.js";
import { LuluClient, type LuluClientOptions } from "../src/client.js";
import { type LuluConfig, TOKEN_PATH } from "../src/config.js";
import type { ToolDefinition } from "../src/tools.js";

// ------------------------------------------------------------------ fake Lulu

export interface RecordedRequest {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
  rawBody: string | undefined;
}

export type Handler = (request: RecordedRequest) => Response | Promise<Response>;

export const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** A fake fetch that serves Lulu's token endpoint and records every API request. */
export function fakeLulu(handler: Handler = () => jsonResponse({ ok: true })) {
  const requests: RecordedRequest[] = [];
  const tokenRequests: RecordedRequest[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const rawBody = typeof init?.body === "string" ? init.body : undefined;
    const contentType = new Headers(init?.headers).get("content-type") ?? "";
    const request: RecordedRequest = {
      method: init?.method ?? "GET",
      url,
      headers: new Headers(init?.headers),
      rawBody,
      body: rawBody !== undefined && contentType.includes("json") ? JSON.parse(rawBody) : undefined,
    };
    if (url.pathname === TOKEN_PATH) {
      tokenRequests.push(request);
      return jsonResponse({ access_token: `token-${tokenRequests.length}`, expires_in: 3600 });
    }
    requests.push(request);
    return handler(request);
  };
  return { fetch, requests, tokenRequests };
}

export const testConfig: LuluConfig = {
  clientKey: "test-client-key",
  clientSecret: "test-client-secret",
  environment: "sandbox",
  timeoutMs: 5000,
};

export function makeClient(
  fake: { fetch: FetchLike },
  options: LuluClientOptions = {},
  config: Partial<LuluConfig> = {},
): LuluClient {
  return new LuluClient({ ...testConfig, ...config }, { fetch: fake.fetch, sleep: () => Promise.resolve(), ...options });
}

/** Parses tool input the way the MCP SDK does before calling the handler. */
export function parseInput(tool: ToolDefinition, input: unknown): Record<string, unknown> {
  return z.object(tool.inputSchema).parse(input);
}

// ------------------------------------------------------------------ the spec

type Json = Record<string, any>;

export const SPEC_FILE = new URL("../spec/openapi_public.yml", import.meta.url);
export const spec: Json = parse(readFileSync(SPEC_FILE, "utf8"));

export const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

export interface SpecOperation {
  method: string;
  specPath: string;
  /** The real URL path: the spec pads one duplicate key with a hair space. */
  path: string;
  operation: Json;
}

export function specOperations(): SpecOperation[] {
  const result: SpecOperation[] = [];
  for (const [specPath, item] of Object.entries<Json>(spec.paths)) {
    for (const method of HTTP_METHODS) {
      if (item[method]) {
        result.push({
          method: method.toUpperCase(),
          specPath,
          path: specPath.replace(/[\u2000-\u200b\s]/g, ""),
          operation: item[method],
        });
      }
    }
  }
  return result;
}

export function findOperation(method: string, specPath: string): SpecOperation {
  const op = specOperations().find((o) => o.method === method && o.specPath === specPath);
  if (!op) throw new Error(`No spec operation ${method} ${JSON.stringify(specPath)}`);
  return op;
}

export function requestBodySchema(op: SpecOperation): Json | undefined {
  return op.operation.requestBody?.content?.["application/json"]?.schema as Json | undefined;
}

/** Request examples, whether the spec gives them as `examples` or a single `example`. */
export function requestExamples(op: SpecOperation): unknown[] {
  const content = op.operation.requestBody?.content?.["application/json"] ?? {};
  const named = Object.values<{ value: unknown }>(content.examples ?? {}).map((e) => e.value);
  return content.example === undefined ? named : [...named, content.example];
}

export function parameters(op: SpecOperation, location: "query" | "path"): Json[] {
  return ((op.operation.parameters ?? []) as Json[]).filter((p) => p.in === location);
}

/**
 * Names the spec lists as required without defining them. Only a Print-Job's
 * `status` does this; Lulu sets it, and none of the spec's own examples send it.
 * tests/spec-quirks.test.ts checks this list stays exact.
 */
export const UNDEFINED_REQUIRED = new Set(["status"]);

/** Every place a schema lists a required name that its properties don't define. */
export function undefinedRequired(schema: unknown, at = ""): string[] {
  if (Array.isArray(schema)) return schema.flatMap((s, i) => undefinedRequired(s, `${at}[${i}]`));
  if (typeof schema !== "object" || schema === null) return [];
  const s = schema as Json;
  if (s.readOnly) return [];
  const found: string[] = [];
  if (Array.isArray(s.required) && s.properties) {
    for (const name of s.required as string[]) if (!(name in s.properties)) found.push(`${at}:${name}`);
  }
  for (const [key, value] of Object.entries(s)) found.push(...undefinedRequired(value, `${at}/${key}`));
  return found;
}

/**
 * The schema of what a client may send: readOnly properties removed (the spec
 * lists some of them as required, e.g. a Print-Job's `id` and `status`).
 */
export function writeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(writeSchema);
  if (typeof schema !== "object" || schema === null) return schema;
  const source = schema as Json;
  const out: Json = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "properties") {
      const props: Json = {};
      for (const [name, prop] of Object.entries<Json>(value)) {
        if (!prop.readOnly) props[name] = writeSchema(prop);
      }
      out.properties = props;
    } else if (key === "required") {
      const props: Json = source.properties ?? {};
      out.required = (value as string[]).filter(
        (name) => !props[name]?.readOnly && !(source.properties && UNDEFINED_REQUIRED.has(name) && !(name in props)),
      );
    } else if (key === "example" || key === "examples" || key === "readOnly" || key === "writeOnly") {
      // annotations only
    } else if (key === "nullable") {
      // handled with type below
    } else {
      out[key] = writeSchema(value);
    }
  }
  if (source.nullable === true && typeof source.type === "string") out.type = [source.type, "null"];
  return out;
}

const ajv = new Ajv({ strict: false, allErrors: true });
(addFormatsModule as unknown as (a: Ajv) => void)(ajv);
ajv.addFormat("int32", true);
ajv.addFormat("int64", true);

export function bodyValidator(op: SpecOperation): ValidateFunction | undefined {
  const schema = requestBodySchema(op);
  return schema ? ajv.compile(writeSchema(schema) as object) : undefined;
}

/**
 * Every writable property path in a schema, e.g. "line_items[].printable_normalization.cover.source_url".
 * Follows arrays and the first object branch of oneOf/anyOf.
 */
export function writablePaths(schema: unknown, prefix = ""): string[] {
  if (typeof schema !== "object" || schema === null) return [];
  const s = schema as Json;
  if (s.readOnly) return [];
  if (s.type === "array" || s.items) return writablePaths(s.items, `${prefix}[]`);
  const variants: Json[] = [...(s.oneOf ?? []), ...(s.anyOf ?? [])];
  const objectVariant = variants.find((v) => v.properties);
  if (objectVariant && !s.properties) return writablePaths(objectVariant, prefix);
  if (!s.properties) return prefix ? [prefix] : [];
  const paths: string[] = [];
  for (const [name, prop] of Object.entries<Json>(s.properties)) {
    if (prop.readOnly) continue;
    const child = prefix ? `${prefix}.${name}` : name;
    const nested = writablePaths(prop, child);
    paths.push(...(nested.length > 0 ? nested : [child]));
  }
  return paths;
}

/** Every leaf path present in a JSON value, in the same notation as writablePaths. */
export function presentPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((v) => presentPaths(v, `${prefix}[]`)))];
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => presentPaths(v, prefix ? `${prefix}.${k}` : k));
  }
  return prefix ? [prefix] : [];
}
