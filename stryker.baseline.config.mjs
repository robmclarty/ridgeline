/**
 * Stryker mutation testing baseline config — captures the pre-migration
 * mutation score on src/engine/pipeline/ at Phase 10 entry. Used only
 * when baseline/mutation-score.json was previously recorded as
 * captured: false (Phase 1 was blocked by the active sandbox).
 *
 * Phase 11 deletes src/engine/pipeline/, so this baseline must be
 * captured before Phase 11 lands.
 */
export default {
  packageManager: "npm",
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: ".check/mutation.pipeline-baseline.json" },
  vitest: {
    configFile: "vitest.stryker.config.ts",
  },
  mutate: [
    "src/engine/pipeline/**/*.ts",
    "!src/engine/pipeline/**/__tests__/**",
    "!src/engine/pipeline/**/*.test.ts",
    "!src/engine/pipeline/**/*.spec.ts",
    "!src/engine/pipeline/**/*.d.ts",
  ],
  coverageAnalysis: "perTest",
  incremental: false,
  thresholds: { high: 80, low: 60, break: 0 },
  tempDirName: ".stryker-tmp-baseline",
  cleanTempDir: true,
}
