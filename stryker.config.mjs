/**
 * Stryker mutation testing config.
 *
 * Scoped to the fascicle-migration substrate
 * (src/engine/{flows,atoms,composites,adapters}/**\/*.ts) per the
 * fascicle-migration spec. Earlier phases left the wider scope in place;
 * Phase 10 narrows it to the new substrate so the gate is meaningful.
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
  vitest: {
    configFile: "vitest.stryker.config.ts",
  },
  mutate: [
    "src/engine/flows/**/*.ts",
    "src/engine/atoms/**/*.ts",
    "src/engine/composites/**/*.ts",
    "src/engine/adapters/**/*.ts",
    "!src/engine/**/__tests__/**",
    "!src/engine/**/*.test.ts",
    "!src/engine/**/*.spec.ts",
    "!src/engine/**/*.d.ts",
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
