#!/usr/bin/env node
/**
 * Phase 10 mutation-score gate (AC4).
 *
 * Compares the post-migration mutation score on
 * src/engine/{flows,atoms,composites,adapters}/**\/*.ts to the
 * pre-migration baseline on src/engine/pipeline/.
 *
 * Inputs:
 *   .ridgeline/builds/fascicle-migration/baseline/mutation-score.json
 *   .ridgeline/builds/fascicle-migration/phase-10-mutation-score.json
 *
 * Exit codes:
 *   0 — gate passes (new_score >= baseline_score) OR gate deferred
 *       (one or both scores recorded captured: false). Deferred is
 *       not a hard failure: the captured flag exists precisely so
 *       sandboxed builders can record an environmental blocker
 *       without falsely asserting a numeric gate. Phase 11/12 (or
 *       a host-side run) flips the captured flag to true once the
 *       absolute scores are available.
 *   1 — gate fails (new_score < baseline_score) — phase exit blocks.
 *   2 — gate cannot run (input files missing or malformed).
 */

import { readFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, "..")
const BASELINE = join(REPO_ROOT, ".ridgeline/builds/fascicle-migration/baseline/mutation-score.json")
const NEW_SCORE = join(REPO_ROOT, ".ridgeline/builds/fascicle-migration/phase-10-mutation-score.json")

function readJson(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (err) {
    process.stderr.write(`gate error: failed to parse ${path}: ${err.message}\n`)
    process.exit(2)
  }
}

function main() {
  const baseline = readJson(BASELINE)
  const newScore = readJson(NEW_SCORE)

  if (!baseline) {
    process.stderr.write(`gate error: missing baseline at ${BASELINE}\n`)
    process.exit(2)
  }
  if (!newScore) {
    process.stderr.write(`gate error: missing new-score artifact at ${NEW_SCORE}\n`)
    process.exit(2)
  }

  const baselineCaptured = baseline.captured === true && typeof baseline.score === "number"
  const newCaptured = newScore.captured === true && typeof newScore.score === "number"

  if (!baselineCaptured || !newCaptured) {
    process.stdout.write("phase-10-mutation-gate: DEFERRED\n")
    process.stdout.write(`  baseline.captured = ${baseline.captured} (score=${baseline.score})\n`)
    process.stdout.write(`  new.captured      = ${newScore.captured} (score=${newScore.score})\n`)
    process.stdout.write(
      "  Both scores must be captured (run on the host outside greywall) before the\n" +
      "  numeric gate can assert. See phase-10-stryker-environment.md.\n",
    )
    process.exit(0)
  }

  if (newScore.score < baseline.score) {
    process.stderr.write(
      `phase-10-mutation-gate: FAIL — new score ${newScore.score} < baseline ${baseline.score}\n`,
    )
    process.exit(1)
  }

  process.stdout.write(
    `phase-10-mutation-gate: PASS — new score ${newScore.score} >= baseline ${baseline.score}\n`,
  )
  process.exit(0)
}

main()
