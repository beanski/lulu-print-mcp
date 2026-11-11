/**
 * Input schemas. Every constraint here comes from Lulu's OpenAPI spec
 * (spec/openapi_public.yml); see docs/spec-notes.md for the few places the
 * spec contradicts itself and which reading we follow.
 */
import { z } from "zod";

export const SHIPPING_LEVELS = [
  "MAIL",
  "PRIORITY_MAIL",
  "GROUND_HD",
  "GROUND_BUS",
  "GROUND",
  "EXPEDITED",
  "EXPRESS",
] as const;

export const ADDRESS_TITLES = ["MR", "MISS", "MRS", "MS", "DR"] as const;
export const WEBHOOK_TOPICS = ["PRINT_JOB_STATUS_CHANGED"] as const;
export const COVER_DIMENSION_UNITS = ["pt", "mm", "inch"] as const;

/** Foil stamp title and author text together may not exceed this (spec, "Linen Wrap Foil"). */
export const FOIL_STAMP_MAX_COMBINED = 42;

export const podPackageId = z
  .string()
  .min(1)
  .max(100)
  .describe(
    "Lulu product SKU (pod_package_id): trim size, ink, quality, binding, paper and finish. " +
      "Dotted format, e.g. '0600X0900.BW.STD.PB.060UW444.MXX' (6x9in black-and-white standard paperback, matte). " +
      "Lulu still accepts the older 27-character format without dots until 1 February 2027. " +
      "Build one with Lulu's pricing calculator: https://developers.lulu.com/price-calculator",
  );

export const shippingLevel = z
  .enum(SHIPPING_LEVELS)
  .describe("Shipping service level, from slowest/cheapest (MAIL) to fastest (EXPRESS).");

/** Path ids: letters, digits, '-' and '_' only, so they can't change the URL path. */
export const resourceId = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, "must contain only letters, digits, '-' and '_'");

export const integerId = z.number().int().positive();

export const httpUrl = z
  .url({ protocol: /^https?$/ })
  .describe(
    "Public http(s) URL Lulu downloads the file from. Basic-auth credentials in the URL are allowed.",
  );

export const pageCount = z.number().int().positive();
export const quantity = z.number().int().positive();

export const pagination = {
  page: z.number().int().positive().optional().describe("Result page, default 1."),
  page_size: z.number().int().positive().optional().describe("Results per page, default 100."),
};

const isoTimestamp = (what: string) =>
  z
    .string()
    .min(1)
    .optional()
    .describe(`Only ${what} this ISO 8601 date or timestamp (UTC), e.g. '2026-11-09' or '2026-11-09T09:30:08Z'.`);

export const timeFilters = {
  created_after: isoTimestamp("items created after"),
  created_before: isoTimestamp("items created before"),
};

export const modifiedFilters = {
  modified_after: isoTimestamp("items modified after"),
  modified_before: isoTimestamp("items modified before"),
};

export const printJobStatusFilter = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Filter by status: CREATED, REJECTED, UNPAID, PAYMENT_IN_PROGRESS, PRODUCTION_READY, " +
      "PRODUCTION_DELAYED, IN_PRODUCTION, ERROR, SHIPPED or CANCELED.",
  );

/** `shipping_address` of a cost calculation (spec: Print-Job-cost-calculations_create). */
export const costShippingAddress = z.object({
  name: z.string().max(35).optional(),
  organization: z.string().max(30).optional(),
  street1: z.string().min(1).max(30),
  street2: z.string().max(30).optional(),
  city: z.string().min(1).max(30),
  state_code: z.string().optional().describe("State, province or region code, e.g. 'NY'."),
  postcode: z.string().min(1).max(64),
  country_code: z.string().length(2).describe("ISO 3166-1 alpha-2 country code, e.g. 'US'."),
  phone_number: z.string().min(1).max(20),
  email: z.email().optional(),
  is_business: z.boolean().optional(),
  title: z.enum(ADDRESS_TITLES).optional(),
});

/** `shipping_address` of a Print-Job (spec: Print-Jobs_create). Name and email are required here. */
export const printJobShippingAddress = costShippingAddress.extend({
  name: z.string().min(1).max(35),
  email: z.email(),
  recipient_tax_id: z
    .string()
    .optional()
    .describe("Recipient's tax id. Required for Brazil (CPF/CNPJ), Chile (RUT) and Mexico (RFC)."),
});

/** `shipping_address` of a shipping-options request (spec: retrieve-shipping-options). */
export const shippingOptionsAddress = z.object({
  name: z.string().optional(),
  organization: z.string().optional(),
  street1: z.string().optional(),
  street2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional().describe("State, province or region code."),
  postcode: z.string().max(64).optional(),
  country: z.string().length(2).describe("ISO 3166-1 alpha-2 country code, e.g. 'US'."),
  phone_number: z.string().max(20).optional(),
  is_business: z.boolean().optional(),
  is_postbox: z.boolean().optional(),
});

export const pricedLineItem = z.object({
  pod_package_id: podPackageId,
  page_count: pageCount.describe("Number of interior pages."),
  quantity,
});

export const fileSource = z.object({
  source_url: httpUrl,
  source_md5_sum: z
    .string()
    .optional()
    .describe("MD5 hash of the file, so Lulu can check it downloaded intact."),
  job_id: z
    .number()
    .int()
    .optional()
    .describe("Id of an existing normalization job for this file. Rarely needed."),
});

export const newPrintJobLineItem = z
  .object({
    title: z.string().max(255).optional().describe("Book title, shown on Lulu's side."),
    quantity,
    pod_package_id: podPackageId,
    external_id: z.string().optional().describe("Your own reference for this line item."),
    interior: fileSource.describe("Interior PDF."),
    cover: fileSource.describe("Cover PDF (one spread: back, spine, front)."),
    foil_stamp_title_text: z
      .string()
      .optional()
      .describe("Linen wrap books only: title text foil-stamped on the spine."),
    foil_stamp_author_text: z
      .string()
      .optional()
      .describe("Linen wrap books only: author text foil-stamped on the spine."),
  })
  .refine(
    (item) =>
      (item.foil_stamp_title_text ?? "").length + (item.foil_stamp_author_text ?? "").length <=
      FOIL_STAMP_MAX_COMBINED,
    {
      message: `foil_stamp_title_text and foil_stamp_author_text together may not exceed ${FOIL_STAMP_MAX_COMBINED} characters`,
    },
  );

export const reprintLineItem = z.object({
  title: z.string().max(255).optional(),
  quantity,
  printable_id: z
    .uuid()
    .describe("printable_id of a line item from an earlier, successfully created Print-Job."),
  pod_package_id: podPackageId.optional(),
  external_id: z.string().optional(),
});

export const printJobCommon = {
  contact_email: z.email().describe("Email Lulu uses for questions about this Print-Job."),
  shipping_level: shippingLevel,
  shipping_address: printJobShippingAddress,
  external_id: z.string().optional().describe("Your own order number or reference."),
  production_delay: z
    .number()
    .int()
    .min(60)
    .max(2880)
    .optional()
    .describe("Minutes (60 to 2880) to wait before production starts, leaving time to cancel."),
};

export const webhookTopics = z.array(z.enum(WEBHOOK_TOPICS)).min(1);
