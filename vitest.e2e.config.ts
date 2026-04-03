import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["test/setup.ts"],
    include: ["test/e2e/**/*.test.ts"],
    testTimeout: 600_000, // 10 minutes — real LLM calls are slow
  },
})
