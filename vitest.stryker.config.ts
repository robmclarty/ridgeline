import { defineConfig } from "vitest/config"

// Stryker-specific vitest config. Uses pool: 'forks' so process.chdir() in
// src/commands/__tests__/*.test.ts is permitted under coverageAnalysis: 'perTest'
// (the default 'threads' pool would reject chdir).
export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["test/setup.ts"],
    include: ["src/**/__tests__/**/*.test.ts"],
    exclude: ["test/e2e/**"],
    pool: "forks",
  },
})
