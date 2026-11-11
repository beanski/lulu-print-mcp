/** Inputs that break the spec's rules are rejected before anything reaches Lulu. */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LuluInputError } from "../src/errors.js";
import { TOOLS } from "../src/tools.js";
import { FIXTURES } from "./fixtures.js";

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
const accepts = (name: string, input: unknown) => z.object(tool(name).inputSchema).safeParse(input).success;

/** Deep copy of a fixture with one change applied. */
function variant(name: string, change: (input: any) => void, kind: "minimal" | "maximal" = "maximal") {
  const input = structuredClone(FIXTURES[name]![kind]);
  change(input);
  return input;
}

describe("fixtures", () => {
  it.each(TOOLS.map((t) => t.name))("%s accepts its fixtures", (name) => {
    expect(accepts(name, FIXTURES[name]!.minimal)).toBe(true);
    expect(accepts(name, FIXTURES[name]!.maximal)).toBe(true);
  });
});

describe("address limits from the spec", () => {
  const limits: [string, number][] = [
    ["name", 35],
    ["organization", 30],
    ["street1", 30],
    ["street2", 30],
    ["city", 30],
    ["phone_number", 20],
    ["postcode", 64],
  ];
  for (const name of ["create_print_job", "reprint_print_job", "calculate_print_job_cost"]) {
    it.each(limits)(`${name}: shipping_address.%s allows %i characters, not more`, (field, max) => {
      expect(accepts(name, variant(name, (i) => (i.shipping_address[field] = "x".repeat(max))))).toBe(true);
      expect(accepts(name, variant(name, (i) => (i.shipping_address[field] = "x".repeat(max + 1))))).toBe(false);
    });
  }

  it("needs a two-letter country code", () => {
    expect(accepts("create_print_job", variant("create_print_job", (i) => (i.shipping_address.country_code = "USA")))).toBe(false);
    expect(accepts("get_shipping_options", { ...FIXTURES.get_shipping_options!.minimal, shipping_address: { country: "U" } })).toBe(false);
  });

  it("needs name and email on an order address, but not for a cost estimate", () => {
    for (const field of ["name", "email"]) {
      expect(accepts("create_print_job", variant("create_print_job", (i) => { i.shipping_address = Object.fromEntries(Object.entries(i.shipping_address).filter(([k]) => k !== field)); }, "minimal"))).toBe(false);
    }
    expect(accepts("calculate_print_job_cost", FIXTURES.calculate_print_job_cost!.minimal)).toBe(true);
  });

  it("rejects an address title outside the spec's list", () => {
    expect(accepts("create_print_job", variant("create_print_job", (i) => (i.shipping_address.title = "SIR")))).toBe(false);
  });

  it("rejects a badly formed email", () => {
    expect(accepts("create_print_job", variant("create_print_job", (i) => (i.contact_email = "not-an-email")))).toBe(false);
  });
});

describe("print jobs", () => {
  it("accepts dotted, legacy and up-to-100-character product codes", () => {
    expect(accepts("calculate_cover_dimensions", FIXTURES.calculate_cover_dimensions!.minimal)).toBe(true);
    expect(accepts("calculate_cover_dimensions", FIXTURES.calculate_cover_dimensions!.maximal)).toBe(true);
    const at = (length: number) => ({ pod_package_id: "X".repeat(length), interior_page_count: 10 });
    expect(accepts("calculate_cover_dimensions", at(100))).toBe(true);
    expect(accepts("calculate_cover_dimensions", at(101))).toBe(false);
    expect(accepts("calculate_cover_dimensions", at(0))).toBe(false);
  });

  it("keeps production_delay between 60 and 2880 minutes", () => {
    for (const [delay, ok] of [[59, false], [60, true], [2880, true], [2881, false], [90.5, false]] as const) {
      expect(accepts("create_print_job", variant("create_print_job", (i) => (i.production_delay = delay)))).toBe(ok);
    }
  });

  it("only allows the spec's shipping levels", () => {
    expect(accepts("create_print_job", variant("create_print_job", (i) => (i.shipping_level = "OVERNIGHT")))).toBe(false);
    expect(accepts("calculate_print_job_cost", variant("calculate_print_job_cost", (i) => (i.shipping_option = "FAST")))).toBe(false);
  });

  it("limits combined foil stamp text to 42 characters", () => {
    const withFoil = (title: string, author: string) =>
      variant("create_print_job", (i) => {
        i.line_items[0].foil_stamp_title_text = title;
        i.line_items[0].foil_stamp_author_text = author;
      });
    expect(accepts("create_print_job", withFoil("x".repeat(21), "y".repeat(21)))).toBe(true);
    expect(accepts("create_print_job", withFoil("x".repeat(22), "y".repeat(21)))).toBe(false);
  });

  it("needs both files for a new order and a UUID printable_id for a reprint", () => {
    expect(accepts("create_print_job", variant("create_print_job", (i) => delete i.line_items[0].cover))).toBe(false);
    expect(accepts("reprint_print_job", variant("reprint_print_job", (i) => (i.line_items[0].printable_id = "abc")))).toBe(false);
  });

  it("needs at least one line item with a whole, positive quantity", () => {
    expect(accepts("create_print_job", variant("create_print_job", (i) => (i.line_items = [])))).toBe(false);
    for (const quantity of [0, -1, 1.5]) {
      expect(accepts("create_print_job", variant("create_print_job", (i) => (i.line_items[0].quantity = quantity)))).toBe(false);
    }
  });

  it("only accepts http and https file URLs", () => {
    for (const url of ["ftp://files.example.com/a.pdf", "file:///etc/passwd", "javascript:alert(1)", "not a url"]) {
      expect(accepts("validate_interior_file", { source_url: url })).toBe(false);
    }
    expect(accepts("validate_interior_file", { source_url: "https://user:pass@files.example.com/a.pdf" })).toBe(true);
  });
});

describe("ids", () => {
  it.each(["../webhooks", "12/34", "12?x=1", "a b", ".", ""])("rejects unsafe path id %j", (id) => {
    expect(accepts("get_print_job", { id })).toBe(false);
    expect(accepts("delete_webhook", { id })).toBe(false);
  });

  it("needs whole-number ids for file validations", () => {
    expect(accepts("get_interior_validation", { id: "42" })).toBe(false);
    expect(accepts("get_cover_validation", { id: 4.2 })).toBe(false);
    expect(accepts("get_cover_validation", { id: 42 })).toBe(true);
  });

  it("needs a UUID webhook_id filter", () => {
    expect(accepts("list_webhook_submissions", { webhook_id: "123" })).toBe(false);
  });
});

describe("webhooks", () => {
  it("needs at least one topic, from the spec's list", () => {
    expect(accepts("create_webhook", { url: "https://hooks.example.com", topics: [] })).toBe(false);
    expect(accepts("create_webhook", { url: "https://hooks.example.com", topics: ["ORDER_PAID"] })).toBe(false);
    expect(accepts("test_webhook", { id: "abc", topic: "ORDER_PAID" })).toBe(false);
  });

  it("refuses an update that changes nothing", () => {
    const update = tool("update_webhook");
    expect(() => update.buildRequest({ id: "abc" })).toThrow(LuluInputError);
  });
});

describe("cover dimensions", () => {
  it("only allows pt, mm or inch", () => {
    expect(accepts("calculate_cover_dimensions", { ...FIXTURES.calculate_cover_dimensions!.minimal, unit: "cm" })).toBe(false);
  });
});
