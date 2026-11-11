# Notes on Lulu's OpenAPI spec

This server is built against `spec/openapi_public.yml`, which is Lulu's published spec, last downloaded on 11 November 2026. In a few places the spec contradicts itself. This page says which reading we follow and why. Tests in `tests/spec-quirks.test.ts` and `tests/contract.test.ts` pin down each case, so a change in the spec shows up as a failing test.

## 1. Where `pod_package_id` goes in a new Print-Job

- **Schema:** `line_items[].pod_package_id`
- **Examples and code samples:** `line_items[].printable_normalization.pod_package_id`

`create_print_job` sends the value in **both** places. Lulu ignores fields it doesn't recognise, so whichever location the API actually reads gets the value. The sandbox test `creates, reads, reprints and cancels print jobs` checks that the created job reports the product code we sent.

## 2. Foil stamp text

The "Linen Wrap Foil" section describes `foil_stamp_title_text` and `foil_stamp_author_text`, and says the two together may not exceed 42 characters. They don't appear in any schema. The "Example Linen Wrap Book" request puts them in `printable_normalization`, so that is where we send them, and we enforce the 42-character limit.

## 3. Required but undefined `status`

Both Print-Job request schemas list `id` and `status` as required. `id` is read-only, so clients don't send it, and `status` is never defined. Lulu sets both itself, and none of the spec's examples send either. We don't send them either. The test helper drops `status` from the required list, and only for this case: a test fails if any other request schema starts doing the same.

## 4. Reprints and `recipient_tax_id`

The spec documents reprints as a separate operation. Its path key is `"/print-jobs/"` with a trailing hair space (U+200A) so that it doesn't clash with the create operation. On the wire, a reprint is the same `POST /print-jobs/` as any other order. The reprint schema leaves out `shipping_address.recipient_tax_id`, but the create schema includes it, and the spec says it is required for Brazil, Chile and Mexico. So `reprint_print_job` accepts it too.

## 5. Shorthand file fields

New Print-Jobs can name their files in three ways:

1. `printable_normalization.{interior,cover}`
2. The shorthand `line_items[].{interior,cover}` (a URL string or an object)
3. A `printable_id`

`create_print_job` always uses the first form. `reprint_print_job` covers `printable_id`. The shorthand does the same job as the first form, so no tool exposes it.

## 6. Response formats

Some money fields come back as numbers in one endpoint and strings in another. The tools pass Lulu's responses through unchanged instead of parsing them into fixed types, so a change in a response's shape can't break a tool.
