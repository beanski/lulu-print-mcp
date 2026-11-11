# Contributing

Thanks for helping. The goal of this project is to match Lulu's API exactly, so most changes start from the spec.

## Setup

```bash
npm install
npm run check
```

`npm run check` runs type checking, lint, the tests with coverage, and the build. It must pass before a pull request is merged.

## When Lulu changes its API

1. Run `npm run spec:check -- --update`. This replaces `spec/openapi_public.yml` with Lulu's live copy.
2. Run `npm test`. The tests name every tool and field that no longer matches the spec.
3. Update `src/schemas.ts` and `src/tools.ts` until the tests pass, and add any new fields to `tests/fixtures.ts`.
4. If the spec contradicts itself, record it in `docs/spec-notes.md` with a test.
5. Add an entry to `CHANGELOG.md`.

## Rules

- Each spec operation gets exactly one tool. Every input constraint comes from the spec.
- Every tool needs a minimal and a maximal fixture, and a call in `tests/sandbox/live.test.ts`.
- Don't add fields that the spec doesn't document.
- Keep tool descriptions plain and short: an AI model reads them to decide what to call.

## Live tests

Sandbox keys are free from https://developers.sandbox.lulu.com/.

```bash
LULU_SANDBOX_CLIENT_KEY=... LULU_SANDBOX_CLIENT_SECRET=... npm run test:sandbox
```

## Releasing

1. Update `version` in `package.json` and `src/version.ts`, and add a `## <version>` section to `CHANGELOG.md`.
2. Merge to `main` and wait for CI to pass.
3. Start the release workflow: either run it from the Actions tab on `main`, or push a tag for the version (for example `git tag v1.0.1 && git push origin v1.0.1`). It publishes to npm, then creates the GitHub release and tag, with the changelog section as its notes.
