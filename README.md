# lulu-print-mcp

An [MCP](https://modelcontextprotocol.io) server for the [Lulu Print API](https://developers.lulu.com/). It lets Claude and other AI assistants price, validate, order and track print-on-demand books.

- **Covers the whole API.** There is one tool for each of the 22 operations in Lulu's published OpenAPI spec, and a test fails if any operation is missing.
- **Built exactly to the spec.** Every request is checked against Lulu's own spec in the test suite. The few places where the spec contradicts itself are written up in [docs/spec-notes.md](docs/spec-notes.md).
- **Safe by default.** It uses Lulu's **sandbox** unless you choose production, so you can't place a real order by accident.
- **Ready for Lulu's new product codes.** It accepts the dotted `pod_package_id` format, and the old 27-character format until Lulu retires it on 1 February 2027.

## Install

You need [Node.js](https://nodejs.org) 20 or newer and Lulu API keys. Get your keys from the [sandbox developer portal](https://developers.sandbox.lulu.com/) (free test orders) or the [production portal](https://developers.lulu.com/) (real orders). The two environments use different keys.

### Claude Desktop

Add this to `claude_desktop_config.json` (in Claude Desktop, go to Settings → Developer → Edit Config), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "lulu-print": {
      "command": "npx",
      "args": ["-y", "lulu-print-mcp"],
      "env": {
        "LULU_CLIENT_KEY": "your-client-key",
        "LULU_CLIENT_SECRET": "your-client-secret",
        "LULU_ENVIRONMENT": "sandbox"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add lulu-print -e LULU_CLIENT_KEY=your-client-key -e LULU_CLIENT_SECRET=your-client-secret -e LULU_ENVIRONMENT=sandbox -- npx -y lulu-print-mcp
```

### Other MCP clients

Run `npx -y lulu-print-mcp` as a stdio server with the environment variables below.

## Configuration

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `LULU_CLIENT_KEY` | yes | | Client key from Lulu's developer portal |
| `LULU_CLIENT_SECRET` | yes | | Client secret from Lulu's developer portal |
| `LULU_ENVIRONMENT` | no | `sandbox` | `sandbox` or `production` |
| `LULU_TIMEOUT_MS` | no | `30000` | Timeout for each request to Lulu, in milliseconds |

> **Production places real orders.** In production, `create_print_job` and `reprint_print_job` create orders that stay unpaid until you pay for them in Lulu's portal, or that are charged automatically if a card is on file. The server tells the assistant to confirm with you before ordering. Use `production_delay` to leave time to cancel.

## Tools

| Tool | Lulu API | What it does |
| --- | --- | --- |
| `calculate_print_job_cost` | POST `/print-job-cost-calculations/` | Price one or more books, including shipping and tax, without placing an order. |
| `list_print_jobs` | GET `/print-jobs/` | List Print-Jobs (orders), newest first by default, with optional filters and paging. |
| `create_print_job` | POST `/print-jobs/` | Place an order to print and ship books from interior and cover PDF URLs. |
| `reprint_print_job` | POST `/print-jobs/` | Place a new order for books Lulu already has, using each line item's printable_id from an earlier Print-Job, so files don't need to be sent again. |
| `get_print_job_statistics` | GET `/print-jobs/statistics/` | Count Print-Jobs in each status, optionally filtered by date, status or id. |
| `get_print_job` | GET `/print-jobs/{id}/` | Get one Print-Job with its line items, status, costs, shipping address and tracking. |
| `get_print_job_costs` | GET `/print-jobs/{id}/costs/` | Get the cost breakdown of an existing Print-Job: line items, shipping, fees, tax, totals. |
| `get_print_job_status` | GET `/print-jobs/{id}/status/` | Get only the current status of a Print-Job, with any status messages. |
| `cancel_print_job` | PUT `/print-jobs/{id}/status/` | Cancel a Print-Job. |
| `get_shipping_options` | POST `/shipping-options/` | List the shipping levels available for some books to a destination, with price and delivery estimates. |
| `create_webhook` | POST `/webhooks/` | Subscribe a URL to Lulu events. |
| `list_webhooks` | GET `/webhooks/` | List all webhook subscriptions on this Lulu account. |
| `get_webhook` | GET `/webhooks/{id}/` | Get one webhook subscription. |
| `update_webhook` | PATCH `/webhooks/{id}/` | Change a webhook's URL or topics, or switch it on or off. |
| `delete_webhook` | DELETE `/webhooks/{id}/` | Delete a webhook subscription. |
| `test_webhook` | POST `/webhooks/{id}/test-submission/{topic}/` | Ask Lulu to send a sample event of the given topic to a webhook's URL. |
| `list_webhook_submissions` | GET `/webhook-submissions/` | List past webhook deliveries and whether each one succeeded, for troubleshooting. |
| `validate_interior_file` | POST `/validate-interior/` | Start checking an interior PDF. |
| `get_interior_validation` | GET `/validate-interior/{id}/` | Get the result of an interior file validation started with validate_interior_file. |
| `calculate_cover_dimensions` | POST `/cover-dimensions/` | Get the exact cover size (including spine and bleed) needed for a product and page count. |
| `validate_cover_file` | POST `/validate-cover/` | Start checking a cover PDF against a product and page count. |
| `get_cover_validation` | GET `/validate-cover/{id}/` | Get the result of a cover file validation started with validate_cover_file. |

A typical order goes like this:

1. `calculate_cover_dimensions` to get the cover size for the book.
2. `validate_interior_file` and `validate_cover_file` to check the PDFs.
3. `get_shipping_options` to see delivery choices.
4. `calculate_print_job_cost` to get the price.
5. `create_print_job` to place the order.
6. `get_print_job_status` to track it.

Tools that only read data are marked read-only, and `cancel_print_job` and `delete_webhook` are marked destructive, so MCP clients can ask before running them.

## Use it as a library

```ts
import { createLuluServer, LuluClient, loadConfig } from "lulu-print-mcp";

const client = new LuluClient(loadConfig());
const jobs = await client.request({ method: "GET", path: "/print-jobs/", query: { page_size: 10 } });
```

## How it's kept exact

- `spec/openapi_public.yml` is a byte-for-byte copy of [Lulu's published spec](https://api.lulu.com/api-docs/openapi-specs/openapi_public.yml).
- The contract tests check that:
  - every operation in the spec has exactly one tool;
  - every request each tool sends passes validation against the spec;
  - each tool can send every writable field in the spec;
  - no tool sends a field the spec doesn't document.
- Live tests run every tool against Lulu's sandbox.
- A weekly GitHub Action compares our copy with Lulu's live spec and opens an issue if Lulu changes it.

## Development

```bash
npm install
npm run check
```

`npm run check` runs type checking, lint, the tests with coverage, and the build.

To run the live sandbox tests:

```bash
LULU_SANDBOX_CLIENT_KEY=... LULU_SANDBOX_CLIENT_SECRET=... npm run test:sandbox
```

To see whether Lulu has changed its spec:

```bash
npm run spec:check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for more.

## License

[MIT](LICENSE). This project is not affiliated with or endorsed by Lulu Press, Inc.
