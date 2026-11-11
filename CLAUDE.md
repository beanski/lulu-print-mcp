# lulu-print-mcp

A public, open-source TypeScript MCP server for the Lulu Print API. It is published by Beanski LLC.

- Build exactly to `spec/openapi_public.yml`, Lulu's published spec. Don't edit that file by hand: run `npm run spec:check -- --update`.
- Each spec operation gets one tool in `src/tools.ts`. Input rules live in `src/schemas.ts` and must come from the spec.
- Record any place the spec contradicts itself in `docs/spec-notes.md`, with a test.
- Before saying a change is done, run `npm run check`. It must pass.
- If you have sandbox keys, also run `npm run test:sandbox`.
- This repo is public, so never commit keys or customer data.
