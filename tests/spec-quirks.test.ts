/** Pins down the places Lulu's spec contradicts itself (see docs/spec-notes.md). */
import { describe, expect, it } from "vitest";
import {
  findOperation,
  presentPaths,
  requestBodySchema,
  requestExamples,
  spec,
  specOperations,
  undefinedRequired,
  UNDEFINED_REQUIRED,
} from "./helpers.js";

describe("Lulu spec quirks", () => {
  it("only Print-Job request bodies list an undefined required field, and it's `status`", () => {
    const found = specOperations().flatMap((op) =>
      undefinedRequired(requestBodySchema(op)).map((where) => `${op.method} ${op.path} ${where}`),
    );
    expect(found).toEqual(["POST /print-jobs/ :status", "POST /print-jobs/ :status"]);
    expect([...UNDEFINED_REQUIRED]).toEqual(["status"]);
  });

  it("none of the spec's Print-Job examples send `status`", () => {
    for (const specPath of ["/print-jobs/", "/print-jobs/\u200a"]) {
      const examples = requestExamples(findOperation("POST", specPath));
      expect(examples.length).toBeGreaterThan(0);
      for (const example of examples) expect(example).not.toHaveProperty("status");
    }
  });

  it("the spec's examples put pod_package_id inside printable_normalization", () => {
    const examples = requestExamples(findOperation("POST", "/print-jobs/"));
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      expect(presentPaths(example)).toContain("line_items[].printable_normalization.pod_package_id");
    }
  });

  it("is still the version this package was built against", () => {
    expect(spec.openapi).toBe("3.0.0");
    expect(spec.info.version).toBe("v1");
    expect(spec.servers.map((s: { url: string }) => s.url)).toEqual([
      "https://api.lulu.com",
      "https://api.sandbox.lulu.com",
    ]);
  });
});
