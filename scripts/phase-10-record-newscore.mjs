#!/usr/bin/env node
/**
 * Phase 10 helper: write the post-migration Stryker mutation score for
 * src/engine/{flows,atoms,composites,adapters} into
 * .ridgeline/builds/fascicle-migration/phase-10-mutation-score.json.
 * Run this on the host outside greywall after `npx stryker run`
 * produces .check/mutation.json.
 *
 *   node scripts/phase-10-record-newscore.mjs .check/mutation.json
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, "..")
const ARTIFACT = join(REPO_ROOT, ".ridgeline/builds/fascicle-migration/phase-10-mutation-score.json")

const reportPath = resolve(process.cwd(), process.argv[2] ?? ".check/mutation.json")
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

const artifact = {
  captured: true,
  captured_at: new Date().toISOString(),
  scope: "src/engine/{flows,atoms,composites,adapters}/**/*.ts",
  environment: "host (outside greywall)",
  score,
  killed: counts.Killed,
  survived: counts.Survived,
  timeout: counts.Timeout,
  no_coverage: counts.NoCoverage,
  compile_errors: counts.CompileError,
  runtime_errors: counts.RuntimeError,
  ignored: counts.Ignored,
}

writeFileSync(ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`)
process.stdout.write(`new-scope mutation score recorded: ${score}\n`)
