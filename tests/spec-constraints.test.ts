/**
 * Reads every rule from the spec's request schemas (required fields, lengths,
 * ranges, enums, types, formats) and checks each tool accepts and rejects
 * exactly what the spec does. If Lulu tightens or loosens a rule, this fails
 * and names the field.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ADDRESS_TITLES, COVER_DIMENSION_UNITS, SHIPPING_LEVELS, WEBHOOK_TOPICS } from "../src/schemas.js";
import { TOOLS, type ToolDefinition } from "../src/tools.js";
import { FIXTURES } from "./fixtures.js";
import { bodyValidator, findOperation, parseInput, presentPaths, requestBodySchema, writeSchema } from "./helpers.js";

type Json = Record<string, any>;
const DELETE = Symbol("delete");
type Value = unknown;

interface Case {
  bodyPath: string;
  label: string;
  value: Value;
}

const TOOL_ENUM_VALUES: readonly string[] = [
  ...SHIPPING_LEVELS,
  ...ADDRESS_TITLES,
  ...WEBHOOK_TOPICS,
  ...COVER_DIMENSION_UNITS,
];

/** Test values for one field, from its schema. */
function leafCases(schema: Json, path: string): Case[] {
  const cases: Case[] = [];
  const add = (label: string, value: Value) => cases.push({ bodyPath: path, label, value });
  if (Array.isArray(schema.enum)) {
    // The spec's values and every value our tools accept, so a value Lulu
    // removes from the spec is caught too.
    for (const value of new Set([...(schema.enum as unknown[]), ...TOOL_ENUM_VALUES])) {
      add(`enum value ${JSON.stringify(value)}`, value);
    }
    add("value outside the enum", "NOT_IN_ENUM");
  }
  if (typeof schema.maxLength === "number") {
    add(`${schema.maxLength} characters`, "x".repeat(schema.maxLength));
    add(`${schema.maxLength + 1} characters`, "x".repeat(schema.maxLength + 1));
  }
  if (typeof schema.minLength === "number") {
    add(`${schema.minLength} characters`, "x".repeat(schema.minLength));
    if (schema.minLength > 0) add(`${schema.minLength - 1} characters`, "x".repeat(schema.minLength - 1));
  }
  if (typeof schema.minimum === "number") {
    add(`minimum ${schema.minimum}`, schema.minimum);
    add(`below minimum`, schema.minimum - 1);
  }
  if (typeof schema.maximum === "number") {
    add(`maximum ${schema.maximum}`, schema.maximum);
    add(`above maximum`, schema.maximum + 1);
  }
  if (schema.format === "email") {
    for (const value of ["pat@example.com", "a.b+c@sub.example.co", "no-at-sign", "a@b", '"quoted"@example.com', ""]) {
      add(`email ${JSON.stringify(value)}`, value);
    }
  }
  if (schema.format === "uuid") {
    add("a UUID", "0f3c2a6e-6c9d-4a51-9a0e-6c1a5f6b2d11");
    add("not a UUID", "not-a-uuid");
  }
  switch (schema.type) {
    case "string":
      add("a number instead of a string", 123);
      if (!schema.enum && !schema.format && !schema.minLength) add("an empty string", "");
      break;
    case "integer":
      add("a fraction", 1.5);
      add("zero", 0);
      add("a string", "1");
      break;
    case "number":
      if (schema.format === "int32" || schema.format === "int64") add("a fraction", 1.5);
      add("zero", 0);
      add("a string", "1");
      break;
    case "boolean":
      add("a string", "true");
      break;
    case "array":
      add("an empty list", []);
      add("not a list", "x");
      break;
  }
  return cases;
}

/** Cases for every field in a request schema. */
function schemaCases(schema: unknown, path = ""): Case[] {
  if (typeof schema !== "object" || schema === null) return [];
  const s = schema as Json;
  const cases: Case[] = path ? leafCases(s, path) : [];
  if (s.items) cases.push(...schemaCases(s.items, `${path}[]`));
  const objectVariant = [...(s.oneOf ?? []), ...(s.anyOf ?? [])].find((v: Json) => v.properties);
  if (objectVariant) cases.push(...schemaCases(objectVariant, path));
  for (const [name, prop] of Object.entries<Json>(s.properties ?? {})) {
    const child = path ? `${path}.${name}` : name;
    if ((s.required as string[] | undefined)?.includes(name)) {
      cases.push({ bodyPath: child, label: "left out (required)", value: DELETE });
    }
    cases.push(...schemaCases(prop, child));
  }
  return cases;
}

/** Sets (or deletes) a value at a path like "line_items[].shipping.name", in every array element. */
function setPath(target: unknown, path: string, value: Value): void {
  const [head, ...rest] = path.split(".");
  const key = head!.replace(/\[\]$/, "");
  const isArray = head!.endsWith("[]");
  const obj = target as Json;
  if (rest.length === 0 && !isArray) {
    if (value === DELETE) Reflect.deleteProperty(obj, key);
    else obj[key] = value;
    return;
  }
  if (!(key in obj)) return;
  if (isArray) {
    const items = obj[key] as unknown[];
    if (rest.length === 0) {
      items.forEach((_, i) => (value === DELETE ? items.splice(i, 1) : (items[i] = value)));
    } else for (const item of items) setPath(item, rest.join("."), value);
  } else setPath(obj[key], rest.join("."), value);
}

/** Where each request-body field lives in the tool's input, when it isn't the same path. */
const INPUT_PATHS: Record<string, (bodyPath: string) => string | undefined> = {
  create_print_job: (bodyPath) =>
    bodyPath.replace(/^line_items\[\]\.printable_normalization\.(interior|cover)/, "line_items[].$1"),
  // The tool always sends {"name": "CANCELED"}; the contract tests check it's valid.
  cancel_print_job: () => undefined,
};

const BODY_TOOLS = TOOLS.filter((tool) => requestBodySchema(findOperation(tool.operation.method, tool.operation.specPath)));

function bodyOf(tool: ToolDefinition, input: unknown): unknown {
  return JSON.parse(JSON.stringify(tool.buildRequest(parseInput(tool, input)).body)) as unknown;
}

describe.each(BODY_TOOLS.map((t) => [t.name, t] as const))("%s follows every rule in the spec", (name, tool) => {
  const op = findOperation(tool.operation.method, tool.operation.specPath);
  const validate = bodyValidator(op)!;
  const maxInput = FIXTURES[name]!.maximal;
  const maxBody = bodyOf(tool, maxInput);
  const sent = new Set(presentPaths(maxBody));
  const toInput = INPUT_PATHS[name] ?? ((p: string) => p);
  const strict = z.strictObject(tool.inputSchema);

  const cases = schemaCases(writeSchema(requestBodySchema(op))).filter(
    // Only fields the tool takes as input; the contract tests check it can send all of them.
    (c) =>
      toInput(c.bodyPath) !== undefined &&
      [...sent].some((p) => p === c.bodyPath || p.startsWith(`${c.bodyPath}.`) || p.startsWith(`${c.bodyPath}[]`)),
  );

  it.skipIf(name === "cancel_print_job")("has rules to check", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases.map((c) => [`${c.bodyPath}: ${c.label}`, c] as const))("%s", (_label, c) => {
    const body = structuredClone(maxBody);
    setPath(body, c.bodyPath, c.value);
    const specAccepts = validate(body);

    const input = structuredClone(maxInput);
    setPath(input, toInput(c.bodyPath)!, c.value);
    const toolAccepts = strict.safeParse(input).success;

    expect(toolAccepts, `spec ${specAccepts ? "accepts" : "rejects"} this`).toBe(specAccepts);
  });
});
