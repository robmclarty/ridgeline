# Development Checks

Ridgeline uses a single command -- `npm run check` -- to run the full
quality pipeline locally. The orchestrator lives at `scripts/check.mjs`,
runs each tool as a subprocess, captures per-tool output to `.check/`,
and writes a normalized `summary.json` that agents can ingest.

This document covers what each check does, how the output is structured,
and how to extend the pipeline (adding a structural rule, a wordlist
entry, a new tool).

## Overview

```text
npm run check
   │
   ├─ types     tsc --noEmit
   ├─ lint      oxlint --type-aware (with tsgolint type-aware rules)
   ├─ struct    ast-grep scan (rules in rules/)
   ├─ agents    agnix (agent/skill metadata validator)
   ├─ dead      fallow (dead code, cycles, duplication, complexity)
   ├─ docs      markdownlint-cli2
   ├─ spell     cspell
   └─ test      vitest run
```

The full default run takes around ten seconds. A ninth check, `mutation`
(stryker), is opt-in and runs only with `npm run check:all` or
`npm run check:mutation`.

## Commands

| Command | What it does |
|---|---|
| `npm run check` | Run the eight default checks. Human-readable status to stderr. |
| `npm run check:bail` | Stop at the first failing check. |
| `npm run check:json` | Emit the summary as JSON on stdout (for agents/CI). |
| `npm run check:all` | Default checks plus stryker mutation testing. |
| `npm run check:mutation` | Stryker only (no other checks). |

The orchestrator also accepts `--only`, `--skip`, and `--include` flags
for arbitrary subsets:

```sh
node scripts/check.mjs --only types,lint,test
node scripts/check.mjs --skip docs,spell
node scripts/check.mjs --include mutation
```

## Output structure

Every run writes to `.check/` (gitignored). For tools that emit JSON,
the orchestrator validates and saves the parsed payload; everything
else is captured verbatim as text.

```text
.check/
├── summary.json           # Aggregate report — exit codes, durations, ok flags
├── lint.json              # Oxlint diagnostics (JSON)
├── struct.json            # Ast-grep diagnostics (JSON)
├── test.json              # Vitest reporter output (JSON)
├── agents.stdout.txt      # Agnix human-readable output
├── dead.stdout.txt        # Fallow report
├── dead.stderr.txt        # Fallow log lines
├── docs.stdout.txt        # Markdownlint diagnostics
└── ...                    # Per-tool stdout/stderr where relevant
```

### `summary.json` schema

```json
{
  "timestamp": "2026-05-05T04:22:38.584Z",
  "ok": true,
  "total_duration_ms": 11848,
  "checks": [
    {
      "name": "types",
      "description": "TypeScript type checking",
      "ok": true,
      "exit_code": 0,
      "duration_ms": 1788,
      "output_file": null
    }
  ]
}
```

The orchestrator never parses individual tool diagnostics itself --
agents read the per-tool artifacts directly. That keeps the orchestrator
upgrade-proof when a tool changes its diagnostic format.

## What each check covers

### `types` -- TypeScript type checking

Runs `tsc --noEmit -p tsconfig.check.json`. Catches type errors before
they reach lint or test.

### `lint` -- Oxlint with tsgolint

Runs `oxlint --type-aware`, which loads the `oxlint-tsgolint` plugin.
Type-aware rules catch issues a syntactic linter can't see:
`unbound-method`, `no-base-to-string`, `restrict-template-expressions`,
and similar.

The lint output is JSON-formatted to `.check/lint.json` so agents can
triage diagnostics by file and rule.

### `struct` -- Ast-grep structural rules

Runs `ast-grep scan` against `rules/*.yml`. Structural rules enforce
project-specific invariants that are hard to express in a syntactic
linter:

- `no-test-only` -- block `it.only`/`test.only`/`describe.only` from
  being committed; focused tests silently skip the rest of the suite.
- `no-default-export` -- prefer named exports for stable, discoverable
  identifiers.
- `no-class` -- prefer functional/procedural style with closures over
  classes.

Each rule is one YAML file pointing at an AST kind or pattern. The
config lives in `sgconfig.yml` at the repo root.

### `agents` -- Agnix

Validates agent and skill metadata under `.claude/`. Catches missing
description triggers, malformed frontmatter, version drift.

### `dead` -- Fallow

A single tool that covers four signals:

- Dead files and unused exports (with `.fallowrc.json` allowlists for
  legitimate exceptions like type definitions consumed dynamically).
- Circular dependencies.
- Duplication via suffix-array clone detection.
- Complexity hotspots (cyclomatic and cognitive thresholds).

Fallow auto-detects other plugin configs in the repo (oxlint, markdown,
cspell, vitest) so it can correlate signals across them.

### `docs` -- Markdownlint

Runs `markdownlint-cli2` against every `.md` file in the repo. Config
lives in `.markdownlint-cli2.jsonc`.

### `spell` -- Cspell

Runs `cspell` against `src/**/*.ts` and `**/*.md`. The wordlist lives
in `cspell.json` at the repo root and is the canonical place to add
project-specific terms (library names, identifier fragments, deliberate
neologisms used in spinner labels and similar).

### `test` -- Vitest

Runs `vitest run` against `src/**/__tests__/**/*.test.ts`. End-to-end
tests under `test/e2e/` are excluded from the default check (run them
with `npm run test:e2e`).

Vitest's JSON reporter writes to `.check/test.json` so agents can read
per-test results without parsing terminal output.

### `mutation` (opt-in) -- Stryker

Mutation testing via `stryker run` with the vitest runner. Incremental
mode keeps re-runs cheap -- the baseline at `stryker.incremental.json`
is checked in so contributors and CI start from the same state.

Thresholds are set in `stryker.config.mjs`:

- `high: 80` (good)
- `low: 60` (warning)
- `break: 50` (fail)

Reports land in `.check/mutation/report.html` and `.check/mutation.json`.

## Extending the pipeline

### Adding a structural rule

1. Drop a `<id>.yml` file in `rules/`. The `id` field, the file name,
   and the message identifier should match. See existing rules for the
   shape -- ast-grep supports both AST-kind matching and pattern
   matching.
2. If the rule should not apply to specific files, list them under
   `ignores:`.
3. Run `npm run check` and confirm the rule fires (or doesn't) where
   you expect.

### Adding a wordlist entry

Add the word to the `words` array in `cspell.json`. Keep the list
sorted-ish (capitalised variants near their lowercase form). Avoid
adding words that look like typos -- if the word is wrong, fix the
source instead.

### Adding a new check

1. Append a check object to the `CHECKS` array in `scripts/check.mjs`:

   ```js
   {
     name: "myCheck",
     description: "Short human label",
     command: "npx",
     args: ["my-tool", "--format=json"],
     output_file: "myCheck.json",  // null for non-JSON tools
     opt_in: false,                 // true to require --include myCheck
   }
   ```

2. The orchestrator runs each check as a subprocess, captures stdout
   and stderr, and persists both. JSON-emitting tools that name an
   `output_file` get their stdout validated and saved as JSON;
   everything else lands in `.check/<name>.{stdout,stderr}.txt`.

3. Order matters: cheaper checks come first so `--bail` fails fast.

### Tuning fallow

Fallow's project config is `.fallowrc.json`. The two knobs that come
up most:

- `ignoreExports` -- annotate types or values that are part of the
  public surface but have no in-repo consumers (re-exported from a
  package boundary, used dynamically, etc.).
- `duplicates.ignore` -- list paths whose duplication is intentional
  (commander option declarations, subprocess-spawn boilerplate). Prefer
  refactoring real duplication; only add to this list when the
  duplication is genuinely unavoidable.

## Why a single command

The pre-existing layout had `npm run lint`, `npm run typecheck`, and
`npm run test:unit` as separate gates. That works for humans but not
for agents -- a Claude Code session would otherwise need to know which
gate is canonical, parse three different output formats, and triage
across them. `npm run check` is the single canonical gate; `.check/`
is the single canonical output location.
