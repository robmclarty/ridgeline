/**
 * Stryker mutation testing config.
 *
 * Invoked by the `mutation` step of `scripts/check.mjs` (opt-in). Incremental
 * mode keeps re-runs cheap — the baseline at `stryker.incremental.json` is
 * committed so every contributor and CI start from the same state.
 */
export default {
  packageManager: "npm",
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: ".check/mutation/report.html" },
  jsonReporter: { fileName: ".check/mutation.json" },
  mutate: [
    "src/**/*.ts",
    "!src/**/__tests__/**",
    "!src/**/*.test.ts",
    "!src/**/*.spec.ts",
    "!src/**/*.d.ts",
  ],
  coverageAnalysis: "perTest",
  incremental: true,
  incrementalFile: "stryker.incremental.json",
  thresholds: {
    high: 80,
    low: 60,
    break: 50,
  },
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
}
