#!/usr/bin/env node
/**
 * Phase 10 test-count audit.
 *
 * AC5: each Tier 1 composite has at least four it/test blocks.
 * AC6: each of the ten atoms has at least one it/test block.
 *
 * Writes:
 *   .ridgeline/builds/fascicle-migration/phase-10-composite-test-counts.json
 *   .ridgeline/builds/fascicle-migration/phase-10-atom-test-counts.json
 *
 * Exits 0 when every threshold is met, 1 otherwise.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, "..")
const ARTIFACT_DIR = join(REPO_ROOT, ".ridgeline/builds/fascicle-migration")

const COMPOSITES = [
  "phase",
  "graph_drain",
  "worktree_isolated",
  "diff_review",
  "cost_capped",
]

const ATOMS = [
  "builder",
  "reviewer",
  "planner",
  "specialist",
  "refiner",
  "researcher",
  "specifier",
  "sensors.collect",
  "plan.review",
  "specialist.verdict",
]

/**
 * Count `it(...)` and `test(...)` blocks at the top level of a test file.
 * Excludes `it.skip`, `it.todo`, `test.skip`, `test.todo`. Counts `it.each`
 * and `test.each` once per call (each call is a parametrized group; we
 * don't expand the expansion).
 */
function countTests(source) {
  const itPattern = /(?:^|[\s;{(])it\s*(?:\.each\([\s\S]*?\))?\s*\(/gm
  const testPattern = /(?:^|[\s;{(])test\s*(?:\.each\([\s\S]*?\))?\s*\(/gm
  const itSkip = /(?:^|[\s;{(])it\s*\.\s*(skip|todo)\s*\(/g
  const testSkip = /(?:^|[\s;{(])test\s*\.\s*(skip|todo)\s*\(/g
  const itMatches = (source.match(itPattern) ?? []).length
  const testMatches = (source.match(testPattern) ?? []).length
  const itSkipped = (source.match(itSkip) ?? []).length
  const testSkipped = (source.match(testSkip) ?? []).length
  return itMatches + testMatches - itSkipped - testSkipped
}

function audit(label, names, basedir) {
  const counts = {}
  let failed = false
  for (const name of names) {
    const file = join(basedir, `${name}.test.ts`)
    if (!existsSync(file)) {
      counts[name] = { count: 0, file: null, ok: false, reason: "missing" }
      failed = true
      continue
    }
    const source = readFileSync(file, "utf8")
    const count = countTests(source)
    counts[name] = { count, file: file.slice(REPO_ROOT.length + 1), ok: false }
  }
  return { counts, failed }
}

function main() {
  const compositeDir = join(REPO_ROOT, "src/engine/composites/__tests__")
  const atomDir = join(REPO_ROOT, "src/engine/atoms/__tests__")

  const composites = audit("composites", COMPOSITES, compositeDir)
  for (const name of COMPOSITES) {
    composites.counts[name].ok = composites.counts[name].count >= 4
    if (!composites.counts[name].ok) composites.failed = true
  }

  const atoms = audit("atoms", ATOMS, atomDir)
  for (const name of ATOMS) {
    atoms.counts[name].ok = atoms.counts[name].count >= 1
    if (!atoms.counts[name].ok) atoms.failed = true
  }

  const compositeArtifact = {
    timestamp: new Date().toISOString(),
    threshold: 4,
    scope: "src/engine/composites/__tests__/<name>.test.ts",
    composites: composites.counts,
    ok: !composites.failed,
  }
  const atomArtifact = {
    timestamp: new Date().toISOString(),
    threshold: 1,
    scope: "src/engine/atoms/__tests__/<name>.test.ts",
    atoms: atoms.counts,
    ok: !atoms.failed,
  }

  writeFileSync(
    join(ARTIFACT_DIR, "phase-10-composite-test-counts.json"),
    `${JSON.stringify(compositeArtifact, null, 2)}\n`,
  )
  writeFileSync(
    join(ARTIFACT_DIR, "phase-10-atom-test-counts.json"),
    `${JSON.stringify(atomArtifact, null, 2)}\n`,
  )

  process.stdout.write(
    `composites (threshold ≥ 4):\n${
      Object.entries(composites.counts)
        .map(([n, v]) => `  ${v.ok ? "✔" : "✘"} ${n.padEnd(20)} ${String(v.count).padStart(2)}`)
        .join("\n")
    }\n`,
  )
  process.stdout.write(
    `atoms (threshold ≥ 1):\n${
      Object.entries(atoms.counts)
        .map(([n, v]) => `  ${v.ok ? "✔" : "✘"} ${n.padEnd(20)} ${String(v.count).padStart(2)}`)
        .join("\n")
    }\n`,
  )

  if (composites.failed || atoms.failed) {
    process.stderr.write("\nphase-10-test-count-audit: FAILED\n")
    process.exit(1)
  }
  process.stdout.write("\nphase-10-test-count-audit: PASSED\n")
}

main()
