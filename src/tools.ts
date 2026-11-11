/**
 * One MCP tool per operation in Lulu's OpenAPI spec. `operation.specPath` is the
 * spec's own path key (character for character), which the coverage test checks.
 */
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { HttpMethod, LuluRequest } from "./client.js";
import {
  costShippingAddress,
  COVER_DIMENSION_UNITS,
  fileSource,
  fileUrl,
  integerId,
  modifiedFilters,
  newPrintJobLineItem,
  pageCount,
  pagination,
  podPackageId,
  pricedLineItem,
  printJobCommon,
  printJobStatusFilter,
  reprintLineItem,
  resourceId,
  shippingLevel,
  shippingOptionsAddress,
  shippingOptionsLineItem,
  timeFilters,
  webhookTopics,
  WEBHOOK_TOPICS,
} from "./schemas.js";

export interface ToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  operation: { method: HttpMethod; specPath: string };
  inputSchema: Shape;
  annotations: ToolAnnotations;
  buildRequest: (input: z.infer<z.ZodObject<Shape>>) => LuluRequest;
}

function defineTool<Shape extends z.ZodRawShape>(tool: ToolDefinition<Shape>): ToolDefinition {
  return tool as unknown as ToolDefinition;
}

/** Path for one resource; ids are already restricted to URL-safe characters. */
const at = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(String(values[key])));

const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: true };
/** Writes that create something new. */
const CREATE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

type FileSource = z.infer<typeof fileSource>;
const source = (file: FileSource) => ({
  source_url: file.source_url,
  source_md5_sum: file.source_md5_sum,
  job_id: file.job_id,
});

export const TOOLS: readonly ToolDefinition[] = [
  // ---------------------------------------------------------------- costs
  defineTool({
    name: "calculate_print_job_cost",
    title: "Calculate print job cost",
    description:
      "Price one or more books, including shipping and tax, without placing an order. " +
      "Returns per-line-item costs, shipping cost, fees and totals.",
    operation: { method: "POST", specPath: "/print-job-cost-calculations/" },
    inputSchema: {
      line_items: z.array(pricedLineItem),
      shipping_address: costShippingAddress,
      shipping_option: shippingLevel,
    },
    annotations: { ...READ, idempotentHint: true },
    buildRequest: (input) => ({ method: "POST", path: "/print-job-cost-calculations/", body: input }),
  }),

  // ---------------------------------------------------------- print jobs
  defineTool({
    name: "list_print_jobs",
    title: "List print jobs",
    description: "List Print-Jobs (orders), newest first by default, with optional filters and paging.",
    operation: { method: "GET", specPath: "/print-jobs/" },
    inputSchema: {
      ...pagination,
      ...timeFilters,
      ...modifiedFilters,
      status: printJobStatusFilter,
      id: z.string().optional().describe("Filter by Print-Job id."),
      order_id: z.string().optional().describe("Filter by order id."),
      exclude_line_items: z
        .boolean()
        .optional()
        .describe("Leave line items out of the response, for shorter results."),
      search: z
        .string()
        .optional()
        .describe(
          "Search ids, external ids, order id, status, line item ids/titles/tracking ids and shipping address.",
        ),
      ordering: z.string().optional().describe("Field to sort by; prefix with '-' for descending."),
    },
    annotations: READ,
    buildRequest: (input) => ({ method: "GET", path: "/print-jobs/", query: input }),
  }),

  defineTool({
    name: "create_print_job",
    title: "Create print job (place an order)",
    description:
      "Place an order to print and ship books from interior and cover PDF URLs. " +
      "In production this is a real order: it stays UNPAID until paid in Lulu's developer portal, " +
      "or is charged automatically if a card is on file. Check the price with calculate_print_job_cost " +
      "and the files with validate_interior_file / validate_cover_file first. " +
      "Set production_delay to leave time to cancel.",
    operation: { method: "POST", specPath: "/print-jobs/" },
    inputSchema: { ...printJobCommon, line_items: z.array(newPrintJobLineItem) },
    annotations: CREATE,
    buildRequest: ({ line_items, ...rest }) => ({
      method: "POST",
      path: "/print-jobs/",
      body: {
        ...rest,
        line_items: line_items.map((item) => ({
          title: item.title,
          quantity: item.quantity,
          external_id: item.external_id,
          pod_package_id: item.pod_package_id,
          printable_normalization: {
            interior: source(item.interior),
            cover: source(item.cover),
            pod_package_id: item.pod_package_id,
            foil_stamp_title_text: item.foil_stamp_title_text,
            foil_stamp_author_text: item.foil_stamp_author_text,
          },
        })),
      },
    }),
  }),

  defineTool({
    name: "reprint_print_job",
    title: "Reprint (re-order) books",
    description:
      "Place a new order for books Lulu already has, using each line item's printable_id from an " +
      "earlier Print-Job, so files don't need to be sent again. Same payment rules as create_print_job.",
    // The spec lists reprints as a separate operation on the same endpoint; its
    // path key carries a hair space (U+200A) to stay unique.
    operation: { method: "POST", specPath: "/print-jobs/ " },
    inputSchema: { ...printJobCommon, line_items: z.array(reprintLineItem) },
    annotations: CREATE,
    buildRequest: (input) => ({ method: "POST", path: "/print-jobs/", body: input }),
  }),

  defineTool({
    name: "get_print_job_statistics",
    title: "Count print jobs by status",
    description: "Count Print-Jobs in each status, optionally filtered by date, status or id.",
    operation: { method: "GET", specPath: "/print-jobs/statistics/" },
    inputSchema: {
      ...pagination,
      ...timeFilters,
      ...modifiedFilters,
      status: printJobStatusFilter,
      id: z.string().optional().describe("Filter by Print-Job id."),
      ordering: z.string().optional().describe("Field to sort by."),
    },
    annotations: READ,
    buildRequest: (input) => ({ method: "GET", path: "/print-jobs/statistics/", query: input }),
  }),

  defineTool({
    name: "get_print_job",
    title: "Get print job",
    description: "Get one Print-Job with its line items, status, costs, shipping address and tracking.",
    operation: { method: "GET", specPath: "/print-jobs/{id}/" },
    inputSchema: { id: resourceId.describe("Print-Job id.") },
    annotations: READ,
    buildRequest: ({ id }) => ({ method: "GET", path: at("/print-jobs/{id}/", { id }) }),
  }),

  defineTool({
    name: "get_print_job_costs",
    title: "Get print job costs",
    description:
      "Get the cost breakdown of an existing Print-Job: line items, shipping, fees, tax, totals. " +
      "Lulu has no costs until it has processed the job's files, and answers 'No costs are available' before then.",
    operation: { method: "GET", specPath: "/print-jobs/{id}/costs/" },
    inputSchema: { id: resourceId.describe("Print-Job id.") },
    annotations: READ,
    buildRequest: ({ id }) => ({ method: "GET", path: at("/print-jobs/{id}/costs/", { id }) }),
  }),

  defineTool({
    name: "get_print_job_status",
    title: "Get print job status",
    description: "Get only the current status of a Print-Job, with any status messages.",
    operation: { method: "GET", specPath: "/print-jobs/{id}/status/" },
    inputSchema: { id: resourceId.describe("Print-Job id.") },
    annotations: READ,
    buildRequest: ({ id }) => ({ method: "GET", path: at("/print-jobs/{id}/status/", { id }) }),
  }),

  defineTool({
    name: "cancel_print_job",
    title: "Cancel print job",
    description:
      "Cancel a Print-Job. Only possible before it goes to production (statuses CREATED, UNPAID " +
      "or PRODUCTION_DELAYED). This cannot be undone.",
    operation: { method: "PUT", specPath: "/print-jobs/{id}/status/" },
    inputSchema: { id: resourceId.describe("Print-Job id.") },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    buildRequest: ({ id }) => ({
      method: "PUT",
      path: at("/print-jobs/{id}/status/", { id }),
      body: { name: "CANCELED" },
    }),
  }),

  // ------------------------------------------------------------- shipping
  defineTool({
    name: "get_shipping_options",
    title: "Get shipping options",
    description:
      "List the shipping levels available for some books to a destination, with price and delivery estimates. " +
      "Only the country is required; a fuller address gives more accurate results.",
    operation: { method: "POST", specPath: "/shipping-options/" },
    inputSchema: {
      line_items: z.array(shippingOptionsLineItem),
      shipping_address: shippingOptionsAddress,
      currency: z.string().optional().describe("Currency for prices, e.g. 'USD'."),
    },
    annotations: { ...READ, idempotentHint: true },
    buildRequest: (input) => ({ method: "POST", path: "/shipping-options/", body: input }),
  }),

  // ------------------------------------------------------------- webhooks
  defineTool({
    name: "create_webhook",
    title: "Create webhook",
    description:
      "Subscribe a URL to Lulu events. Lulu then POSTs to the URL whenever a subscribed event happens, " +
      "e.g. PRINT_JOB_STATUS_CHANGED when an order changes status.",
    operation: { method: "POST", specPath: "/webhooks/" },
    inputSchema: {
      url: z.string().describe("URL that will receive the event POSTs."),
      topics: webhookTopics,
    },
    annotations: CREATE,
    buildRequest: (input) => ({ method: "POST", path: "/webhooks/", body: input }),
  }),

  defineTool({
    name: "list_webhooks",
    title: "List webhooks",
    description: "List all webhook subscriptions on this Lulu account.",
    operation: { method: "GET", specPath: "/webhooks/" },
    inputSchema: {},
    annotations: READ,
    buildRequest: () => ({ method: "GET", path: "/webhooks/" }),
  }),

  defineTool({
    name: "get_webhook",
    title: "Get webhook",
    description: "Get one webhook subscription.",
    operation: { method: "GET", specPath: "/webhooks/{id}/" },
    inputSchema: { id: resourceId.describe("Webhook id.") },
    annotations: READ,
    buildRequest: ({ id }) => ({ method: "GET", path: at("/webhooks/{id}/", { id }) }),
  }),

  defineTool({
    name: "update_webhook",
    title: "Update webhook",
    description: "Change a webhook's URL or topics, or switch it on or off.",
    operation: { method: "PATCH", specPath: "/webhooks/{id}/" },
    inputSchema: {
      id: resourceId.describe("Webhook id."),
      url: z.string().optional().describe("New URL that will receive the event POSTs."),
      topics: webhookTopics.optional(),
      is_active: z.boolean().optional().describe("false pauses the webhook, true resumes it."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    buildRequest: ({ id, ...changes }) => ({
      method: "PATCH",
      path: at("/webhooks/{id}/", { id }),
      body: changes,
    }),
  }),

  defineTool({
    name: "delete_webhook",
    title: "Delete webhook",
    description: "Delete a webhook subscription. This cannot be undone.",
    operation: { method: "DELETE", specPath: "/webhooks/{id}/" },
    inputSchema: { id: resourceId.describe("Webhook id.") },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    buildRequest: ({ id }) => ({ method: "DELETE", path: at("/webhooks/{id}/", { id }) }),
  }),

  defineTool({
    name: "test_webhook",
    title: "Send test webhook",
    description: "Ask Lulu to send a sample event of the given topic to a webhook's URL. The webhook must be active.",
    operation: { method: "POST", specPath: "/webhooks/{id}/test-submission/{topic}/" },
    inputSchema: {
      id: resourceId.describe("Webhook id."),
      topic: z.enum(WEBHOOK_TOPICS).describe("Topic of the sample event."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    buildRequest: ({ id, topic }) => ({
      method: "POST",
      path: at("/webhooks/{id}/test-submission/{topic}/", { id, topic }),
    }),
  }),

  defineTool({
    name: "list_webhook_submissions",
    title: "List webhook deliveries",
    description: "List past webhook deliveries and whether each one succeeded, for troubleshooting.",
    operation: { method: "GET", specPath: "/webhook-submissions/" },
    inputSchema: {
      ...pagination,
      ...timeFilters,
      is_success: z.boolean().optional().describe("true for successful deliveries only, false for failed."),
      response_code: z.string().optional().describe("Filter by the HTTP status your URL returned."),
      webhook_id: z.uuid().optional().describe("Only deliveries for this webhook."),
    },
    annotations: READ,
    buildRequest: (input) => ({ method: "GET", path: "/webhook-submissions/", query: input }),
  }),

  // ------------------------------------------------------ file validation
  defineTool({
    name: "validate_interior_file",
    title: "Validate interior file",
    description:
      "Start checking an interior PDF. Returns a validation record; poll get_interior_validation " +
      "with its id until the status is VALIDATED, NORMALIZED or ERROR. With pod_package_id, Lulu also " +
      "checks the file fits that product.",
    operation: { method: "POST", specPath: "/validate-interior/" },
    inputSchema: {
      source_url: fileUrl,
      pod_package_id: podPackageId.optional(),
    },
    annotations: CREATE,
    buildRequest: (input) => ({ method: "POST", path: "/validate-interior/", body: input }),
  }),

  defineTool({
    name: "get_interior_validation",
    title: "Get interior validation",
    description: "Get the result of an interior file validation started with validate_interior_file.",
    operation: { method: "GET", specPath: "/validate-interior/{id}/" },
    inputSchema: { id: integerId.describe("Validation id.") },
    annotations: READ,
    buildRequest: ({ id }) => ({ method: "GET", path: at("/validate-interior/{id}/", { id }) }),
  }),

  defineTool({
    name: "calculate_cover_dimensions",
    title: "Calculate cover dimensions",
    description: "Get the exact cover size (including spine and bleed) needed for a product and page count.",
    operation: { method: "POST", specPath: "/cover-dimensions/" },
    inputSchema: {
      pod_package_id: podPackageId,
      interior_page_count: pageCount.describe("Number of interior pages."),
      unit: z.enum(COVER_DIMENSION_UNITS).optional().describe("Unit for the result. Lulu's default is pt."),
    },
    annotations: { ...READ, idempotentHint: true },
    buildRequest: (input) => ({ method: "POST", path: "/cover-dimensions/", body: input }),
  }),

  defineTool({
    name: "validate_cover_file",
    title: "Validate cover file",
    description:
      "Start checking a cover PDF against a product and page count. Poll get_cover_validation " +
      "with the returned id until the status is NORMALIZED or ERROR.",
    operation: { method: "POST", specPath: "/validate-cover/" },
    inputSchema: {
      source_url: fileUrl,
      pod_package_id: podPackageId,
      interior_page_count: pageCount.describe("Number of interior pages."),
    },
    annotations: CREATE,
    buildRequest: (input) => ({ method: "POST", path: "/validate-cover/", body: input }),
  }),

  defineTool({
    name: "get_cover_validation",
    title: "Get cover validation",
    description: "Get the result of a cover file validation started with validate_cover_file.",
    operation: { method: "GET", specPath: "/validate-cover/{id}/" },
    inputSchema: { id: integerId.describe("Validation id.") },
    annotations: READ,
    buildRequest: ({ id }) => ({ method: "GET", path: at("/validate-cover/{id}/", { id }) }),
  }),
];
