# Changelog

## 1.0.0

First release.

- One MCP tool for each of the 22 operations in Lulu's OpenAPI spec.
- Supports the dotted `pod_package_id` format, the 2026 address length limits, `recipient_tax_id`, foil stamping and reprints by `printable_id`.
- Uses the sandbox by default. Only GET requests are retried, so an order is never sent twice.
- Contract tests check every request against Lulu's spec, live tests run against the sandbox, and a weekly check watches for spec changes.
