#!/usr/bin/env node
/**
 * Phase 10 helper: write the pre-migration absolute Stryker mutation score
 * into baseline/mutation-score.json. Run this on the host outside
 * greywall after `npx stryker run stryker.baseline.config.mjs` produces
 * .check/mutation.pipeline-baseline.json.
 *
 *   node scripts/phase-10-record-baseline.mjs .check/mutation.pipeline-baseline.json
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, "..")
const BASELINE = join(REPO_ROOT, ".ridgeline/builds/fascicle-migration/baseline/mutation-score.json")

const reportPath = resolve(process.cwd(), process.argv[2] ?? ".check/mutation.pipeline-baseline.json")
if (!existsSync(reportPath)) {
  process.stderr.write(`error: stryker JSON report not found at ${reportPath}\n`)
  process.exit(2)
}

const stryker = JSON.parse(readFileSync(reportPath, "utf8"))
const score = stryker.mutationScore ?? stryker.metrics?.mutationScore
if (typeof score !== "number") {
  process.stderr.write(`error: stryker report at ${reportPath} has no numeric mutationScore field\n`)
  process.exit(2)
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"))
baseline.captured = true
baseline.captured_at_phase = 10
baseline.captured_at = new Date().toISOString()
baseline.environment = "host (outside greywall)"
baseline.score = score
baseline.killed = stryker.metrics?.killed ?? null
baseline.survived = stryker.metrics?.survived ?? null
baseline.timeout = stryker.metrics?.timeout ?? null
baseline.no_coverage = stryker.metrics?.noCoverage ?? null
baseline.compile_errors = stryker.metrics?.compileErrors ?? null
baseline.runtime_errors = stryker.metrics?.runtimeErrors ?? null
baseline.ignored = stryker.metrics?.ignored ?? null
baseline._blocking_for_phase_8 = false
baseline._phase_10_attempts = baseline._phase_10_attempts ?? []
baseline._phase_10_attempts.push({
  ts: baseline.captured_at,
  outcome: "captured",
  details: `Captured on host outside greywall, score=${score}.`,
})

writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`)
process.stdout.write(`baseline updated: score=${score}, captured=true\n`)
