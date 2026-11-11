# Changelog

## 1.0.0

First release.

- One MCP tool for each of the 22 operations in Lulu's OpenAPI spec.
- Supports the dotted `pod_package_id` format, the 2026 address length limits, `recipient_tax_id`, foil stamping and reprints by `printable_id`.
- Rejects unknown or misspelt fields instead of silently dropping them.
- Uses the sandbox by default. Only GET requests are retried, so an order is never sent twice.
- Tests read every input rule from Lulu's spec and check every request against it, live tests run against the sandbox, and a weekly check watches for spec changes.
