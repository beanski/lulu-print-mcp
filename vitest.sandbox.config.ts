import { defineConfig } from "vitest/config";

// Live tests against Lulu's sandbox. Needs LULU_SANDBOX_CLIENT_KEY and
// LULU_SANDBOX_CLIENT_SECRET; every test is skipped without them.
export default defineConfig({
  test: {
    include: ["tests/sandbox/**/*.test.ts"],
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
