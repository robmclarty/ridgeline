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
const counts = { Killed: 0, Survived: 0, Timeout: 0, NoCoverage: 0, CompileError: 0, RuntimeError: 0, Ignored: 0 }
for (const file of Object.values(stryker.files ?? {})) {
  for (const mutant of file.mutants ?? []) {
    counts[mutant.status] = (counts[mutant.status] ?? 0) + 1
  }
}
const detected = counts.Killed + counts.Timeout
const valid = counts.Killed + counts.Survived + counts.Timeout + counts.NoCoverage
if (valid <= 0) {
  process.stderr.write(`error: stryker report at ${reportPath} has no countable mutants\n`)
  process.exit(2)
}
const score = (detected / valid) * 100

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"))
baseline.captured = true
baseline.captured_at_phase = 10
baseline.captured_at = new Date().toISOString()
baseline.environment = "host (outside greywall)"
baseline.score = score
baseline.killed = counts.Killed
baseline.survived = counts.Survived
baseline.timeout = counts.Timeout
baseline.no_coverage = counts.NoCoverage
baseline.compile_errors = counts.CompileError
baseline.runtime_errors = counts.RuntimeError
baseline.ignored = counts.Ignored
baseline._blocking_for_phase_8 = false
baseline._phase_10_attempts = baseline._phase_10_attempts ?? []
baseline._phase_10_attempts.push({
  ts: baseline.captured_at,
  outcome: "captured",
  details: `Captured on host outside greywall, score=${score}.`,
})

writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`)
process.stdout.write(`baseline updated: score=${score}, captured=true\n`)
