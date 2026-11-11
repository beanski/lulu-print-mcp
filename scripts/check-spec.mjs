#!/usr/bin/env node
// Compares spec/openapi_public.yml with the live spec Lulu publishes.
//   node scripts/check-spec.mjs           exit 1 if they differ
//   node scripts/check-spec.mjs --update  overwrite the local copy with the live one
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const LIVE_URL = "https://api.lulu.com/api-docs/openapi-specs/openapi_public.yml";
const LOCAL = new URL("../spec/openapi_public.yml", import.meta.url);
const sha = (text) => createHash("sha256").update(text).digest("hex");

const response = await fetch(LIVE_URL);
if (!response.ok) {
  console.error(`Could not download ${LIVE_URL}: HTTP ${response.status}`);
  process.exit(2);
}
const live = await response.text();
const local = await readFile(LOCAL, "utf8");

if (sha(live) === sha(local)) {
  console.log(`spec/openapi_public.yml matches Lulu's live spec (sha256 ${sha(live)}).`);
} else if (process.argv.includes("--update")) {
  await writeFile(LOCAL, live);
  console.log("Updated spec/openapi_public.yml. Run `npm test`: the contract tests show what changed.");
} else {
  console.error(
    `Lulu's live spec has changed (local ${sha(local).slice(0, 12)}, live ${sha(live).slice(0, 12)}).\n` +
      "Run `npm run spec:check -- --update`, then `npm test` to see which tools need changing.",
  );
  process.exit(1);
}
