import { defineConfig } from "vitest/config"

// Stryker-specific vitest config. @stryker-mutator/vitest-runner forcibly
// sets pool: "threads" regardless of what we set here (see
// node_modules/@stryker-mutator/vitest-runner/dist/src/vitest-test-runner.js),
// so process.chdir() callers cannot be included. We exclude
// src/commands/__tests__/ for that reason; those tests don't cover
// src/engine/{pipeline,flows,atoms,composites,adapters} mutations anyway.
export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["test/setup.ts"],
    include: ["src/engine/**/__tests__/**/*.test.ts", "src/stores/**/__tests__/**/*.test.ts"],
    exclude: ["test/e2e/**"],
  },
})
