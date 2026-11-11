/**
 * Live tests against Lulu's sandbox (no real printing or charges). They prove
 * the spirit of the spec matches the real API, including the places where the
 * spec contradicts itself (docs/spec-notes.md).
 *
 *   LULU_SANDBOX_CLIENT_KEY=... LULU_SANDBOX_CLIENT_SECRET=... npm run test:sandbox
 */
import { describe, expect, it } from "vitest";
import { LuluClient } from "../../src/client.js";
import { runTool } from "../../src/server.js";
import { TOOLS } from "../../src/tools.js";
import { SKU } from "../fixtures.js";

const key = process.env.LULU_SANDBOX_CLIENT_KEY;
const secret = process.env.LULU_SANDBOX_CLIENT_SECRET;
const client = key && secret
  ? new LuluClient({ clientKey: key, clientSecret: secret, environment: "sandbox", timeoutMs: 60_000 })
  : undefined;

// Lulu's own sample files, from the request examples in its spec.
const INTERIOR = "https://www.dropbox.com/s/r20orb8umqjzav9/lulu_trade_interior_template-32.pdf?dl=1&raw=1";
const COVER = "https://www.dropbox.com/s/7bv6mg2tj0h3l0r/lulu_trade_perfect_template.pdf?dl=1&raw=1";
const PAGES = 32;

const address = {
  name: "Sandbox Test",
  street1: "101 Main St",
  city: "Provo",
  state_code: "UT",
  postcode: "84601",
  country_code: "US",
  phone_number: "801-555-0100",
  email: "sandbox@example.com",
};

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const tool = TOOLS.find((t) => t.name === name)!;
  const result = await runTool(client!, tool, args);
  const text = (result.content[0] as { text: string }).text;
  expect(result.isError, `${name}: ${text}`).toBeFalsy();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

describe.skipIf(!client)("Lulu sandbox", () => {
  it("lists print jobs and statistics", async () => {
    expect(await call("list_print_jobs", { page_size: 1, exclude_line_items: true })).toHaveProperty("results");
    await call("get_print_job_statistics", {});
  });

  it("prices a book, lists shipping and sizes its cover", async () => {
    const line = { pod_package_id: SKU, page_count: PAGES, quantity: 1 };
    const cost = await call("calculate_print_job_cost", {
      line_items: [line],
      shipping_address: address,
      shipping_option: "MAIL",
    });
    expect(cost).toHaveProperty("total_cost_incl_tax");
    expect(await call("get_shipping_options", { line_items: [line], shipping_address: { country: "US" } })).toBeTruthy();
    expect(await call("calculate_cover_dimensions", { pod_package_id: SKU, interior_page_count: PAGES })).toBeTruthy();
  });

  it("starts and reads file validations", async () => {
    const interior = await call("validate_interior_file", { source_url: INTERIOR, pod_package_id: SKU });
    expect(await call("get_interior_validation", { id: interior.id })).toHaveProperty("status");
    const cover = await call("validate_cover_file", { source_url: COVER, pod_package_id: SKU, interior_page_count: PAGES });
    expect(await call("get_cover_validation", { id: cover.id })).toHaveProperty("status");
  });

  it("creates, reads, reprints and cancels print jobs", { timeout: 420_000 }, async () => {
    const order = {
      contact_email: "sandbox@example.com",
      shipping_level: "MAIL",
      shipping_address: address,
      production_delay: 2880,
    };
    const job = await call("create_print_job", {
      ...order,
      external_id: `lulu-print-mcp-test-${Date.now()}`,
      line_items: [
        {
          title: "lulu-print-mcp test",
          quantity: 1,
          pod_package_id: SKU,
          interior: { source_url: INTERIOR },
          cover: { source_url: COVER },
        },
      ],
    });
    const id = String(job.id);
    const toCancel = [id];
    try {
      expect(job.line_items[0].pod_package_id).toBe(SKU);
      expect((await call("get_print_job", { id })).id).toBe(job.id);
      expect(await call("get_print_job_status", { id })).toHaveProperty("name");
      await call("get_print_job_costs", { id });

      // Lulu assigns printable_id once it has processed the files.
      let printableId: string | undefined;
      for (let i = 0; i < 36 && !printableId; i++) {
        printableId = (await call("get_print_job", { id })).line_items[0].printable_id ?? undefined;
        if (!printableId) await new Promise((resolve) => setTimeout(resolve, 10_000));
      }
      expect(printableId, "printable_id never appeared").toBeTruthy();

      const reprint = await call("reprint_print_job", {
        ...order,
        line_items: [{ title: "lulu-print-mcp reprint test", quantity: 1, printable_id: printableId }],
      });
      toCancel.push(String(reprint.id));
    } finally {
      for (const jobId of toCancel) expect((await call("cancel_print_job", { id: jobId })).name).toBe("CANCELED");
    }
  });

  it("runs the full webhook lifecycle", async () => {
    const hook = await call("create_webhook", {
      url: "https://example.com/lulu-print-mcp-test",
      topics: ["PRINT_JOB_STATUS_CHANGED"],
    });
    const id = String(hook.id);
    try {
      expect((await call("get_webhook", { id })).url).toBe("https://example.com/lulu-print-mcp-test");
      expect((await call("update_webhook", { id, is_active: false })).is_active).toBe(false);
      await call("test_webhook", { id, topic: "PRINT_JOB_STATUS_CHANGED" });
      expect(await call("list_webhooks", {})).toBeTruthy();
      await call("list_webhook_submissions", { webhook_id: id });
    } finally {
      await call("delete_webhook", { id });
    }
  });
});

// Runs even without keys, so a new tool can't be added without a live test.
it("exercises every tool", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL(import.meta.url), "utf8");
  const missing = TOOLS.map((t) => t.name).filter((name) => !source.includes(`call("${name}"`));
  expect(missing).toEqual([]);
});
