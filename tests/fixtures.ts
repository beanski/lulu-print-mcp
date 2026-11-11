/** A smallest valid input and a "fill in every field" input for every tool. */

export const SKU = "0600X0900.BW.STD.PB.060UW444.MXX";
export const LINEN_SKU = "0600X0900.BW.PRE.LW.060UW444.MNG";
export const LEGACY_SKU = "0600X0900BWSTDPB060UW444MXX";
const PRINTABLE_ID = "0f3c2a6e-6c9d-4a51-9a0e-6c1a5f6b2d11";
const WEBHOOK_ID = "a1b2c3d4-e5f6-4711-8899-aabbccddeeff";
const INTERIOR = "https://files.example.com/interior.pdf";
const COVER = "https://files.example.com/cover.pdf";

const minimalCostAddress = {
  street1: "101 Main St",
  city: "Provo",
  postcode: "84601",
  country_code: "US",
  phone_number: "801-555-0100",
};

const fullCostAddress = {
  ...minimalCostAddress,
  name: "Pat Stitcher",
  organization: "Example Co",
  street2: "Suite 2",
  state_code: "UT",
  email: "pat@example.com",
  is_business: true,
  title: "DR",
};

const minimalJobAddress = { ...minimalCostAddress, name: "Pat Stitcher", email: "pat@example.com" };
const fullJobAddress = { ...fullCostAddress, recipient_tax_id: "12.345.678/0001-90" };

const pricedItem = { pod_package_id: SKU, page_count: 32, quantity: 2 };

const allPrintJobFilters = {
  page: 2,
  page_size: 50,
  created_after: "2026-01-01",
  created_before: "2026-12-31T23:59:59Z",
  modified_after: "2026-02-01T09:30",
  modified_before: "2026-11-09T09:30:08+06:00",
  status: "SHIPPED",
  id: "12345",
  ordering: "-date_created",
};

export interface Fixture {
  minimal: Record<string, unknown>;
  maximal: Record<string, unknown>;
}

export const FIXTURES: Record<string, Fixture> = {
  calculate_print_job_cost: {
    minimal: { line_items: [pricedItem], shipping_address: minimalCostAddress, shipping_option: "MAIL" },
    maximal: { line_items: [pricedItem], shipping_address: fullCostAddress, shipping_option: "EXPRESS" },
  },
  list_print_jobs: {
    minimal: {},
    maximal: {
      ...allPrintJobFilters,
      order_id: "67890",
      exclude_line_items: true,
      search: "My Book",
    },
  },
  create_print_job: {
    minimal: {
      contact_email: "orders@example.com",
      shipping_level: "MAIL",
      shipping_address: minimalJobAddress,
      line_items: [
        { quantity: 1, pod_package_id: SKU, interior: { source_url: INTERIOR }, cover: { source_url: COVER } },
      ],
    },
    maximal: {
      contact_email: "orders@example.com",
      shipping_level: "GROUND",
      shipping_address: fullJobAddress,
      external_id: "order-1001",
      production_delay: 120,
      line_items: [
        {
          title: "My Book",
          quantity: 5,
          pod_package_id: LINEN_SKU,
          external_id: "item-1",
          interior: { source_url: INTERIOR, source_md5_sum: "9e107d9d372bb6826bd81d3542a419d6", job_id: 7 },
          cover: { source_url: COVER, source_md5_sum: "e4d909c290d0fb1ca068ffaddf22cbd0", job_id: 8 },
          foil_stamp_title_text: "My Book",
          foil_stamp_author_text: "Author name",
        },
      ],
    },
  },
  reprint_print_job: {
    minimal: {
      contact_email: "orders@example.com",
      shipping_level: "MAIL",
      shipping_address: minimalJobAddress,
      line_items: [{ quantity: 1, printable_id: PRINTABLE_ID }],
    },
    maximal: {
      contact_email: "orders@example.com",
      shipping_level: "PRIORITY_MAIL",
      shipping_address: fullJobAddress,
      external_id: "order-1002",
      production_delay: 2880,
      line_items: [
        { title: "My Book", quantity: 3, printable_id: PRINTABLE_ID, pod_package_id: SKU, external_id: "item-2" },
      ],
    },
  },
  get_print_job_statistics: { minimal: {}, maximal: allPrintJobFilters },
  get_print_job: { minimal: { id: "12345" }, maximal: { id: "12345" } },
  get_print_job_costs: { minimal: { id: "12345" }, maximal: { id: "12345" } },
  get_print_job_status: { minimal: { id: "12345" }, maximal: { id: "12345" } },
  cancel_print_job: { minimal: { id: "12345" }, maximal: { id: "12345" } },
  get_shipping_options: {
    minimal: { line_items: [pricedItem], shipping_address: { country: "US" } },
    maximal: {
      currency: "USD",
      line_items: [pricedItem],
      shipping_address: {
        name: "Pat Stitcher",
        organization: "Example Co",
        street1: "101 Main St",
        street2: "Suite 2",
        city: "Provo",
        state: "UT",
        postcode: "84601",
        country: "US",
        phone_number: "801-555-0100",
        is_business: false,
        is_postbox: false,
      },
    },
  },
  create_webhook: {
    minimal: { url: "https://hooks.example.com/lulu", topics: ["PRINT_JOB_STATUS_CHANGED"] },
    maximal: { url: "https://hooks.example.com/lulu", topics: ["PRINT_JOB_STATUS_CHANGED"] },
  },
  list_webhooks: { minimal: {}, maximal: {} },
  get_webhook: { minimal: { id: WEBHOOK_ID }, maximal: { id: WEBHOOK_ID } },
  update_webhook: {
    minimal: { id: WEBHOOK_ID, is_active: false },
    maximal: {
      id: WEBHOOK_ID,
      url: "https://hooks.example.com/lulu-v2",
      topics: ["PRINT_JOB_STATUS_CHANGED"],
      is_active: true,
    },
  },
  delete_webhook: { minimal: { id: WEBHOOK_ID }, maximal: { id: WEBHOOK_ID } },
  test_webhook: {
    minimal: { id: WEBHOOK_ID, topic: "PRINT_JOB_STATUS_CHANGED" },
    maximal: { id: WEBHOOK_ID, topic: "PRINT_JOB_STATUS_CHANGED" },
  },
  list_webhook_submissions: {
    minimal: {},
    maximal: {
      page: 1,
      page_size: 20,
      created_after: "2026-01-01",
      created_before: "2026-12-31",
      is_success: false,
      response_code: "500",
      webhook_id: WEBHOOK_ID,
    },
  },
  validate_interior_file: {
    minimal: { source_url: INTERIOR },
    maximal: { source_url: INTERIOR, pod_package_id: SKU },
  },
  get_interior_validation: { minimal: { id: 42 }, maximal: { id: 42 } },
  calculate_cover_dimensions: {
    minimal: { pod_package_id: SKU, interior_page_count: 120 },
    maximal: { pod_package_id: LEGACY_SKU, interior_page_count: 120, unit: "mm" },
  },
  validate_cover_file: {
    minimal: { source_url: COVER, pod_package_id: SKU, interior_page_count: 120 },
    maximal: { source_url: COVER, pod_package_id: SKU, interior_page_count: 120 },
  },
  get_cover_validation: { minimal: { id: 42 }, maximal: { id: 42 } },
};
