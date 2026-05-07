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
const score = stryker.mutationScore ?? stryker.metrics?.mutationScore
if (typeof score !== "number") {
  process.stderr.write(`error: stryker report at ${reportPath} has no numeric mutationScore field\n`)
  process.exit(2)
}

const artifact = {
  captured: true,
  captured_at: new Date().toISOString(),
  scope: "src/engine/{flows,atoms,composites,adapters}/**/*.ts",
  environment: "host (outside greywall)",
  score,
  killed: stryker.metrics?.killed ?? null,
  survived: stryker.metrics?.survived ?? null,
  timeout: stryker.metrics?.timeout ?? null,
  no_coverage: stryker.metrics?.noCoverage ?? null,
  compile_errors: stryker.metrics?.compileErrors ?? null,
  runtime_errors: stryker.metrics?.runtimeErrors ?? null,
  ignored: stryker.metrics?.ignored ?? null,
}

writeFileSync(ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`)
process.stdout.write(`new-scope mutation score recorded: ${score}\n`)
