# ridgeline-inspect — read-only CLI for past builds

A small Node CLI that reads a project's `.ridgeline/builds/` directory and
answers four questions an operator asks all the time: *what builds do I
have, what happened in this one, where did the money go, and which build
mentioned X?* Read-only — it never writes to `.ridgeline/`.

This document is the authoritative source for the build. Use it as-is when
filling in `shape.md`, `spec.md`, `constraints.md`, and `taste.md`. Where
this document is silent, the synthesizer should infer defaults and flag
them under `## Inferred / Gaps`. This is a backend / CLI shape — no
`design.md`, no directions, no visual review.

## Project Identity

- **Name:** `ridgeline-inspect`
- **One-liner:** A read-only terminal inspector for ridgeline build
  artifacts. List builds, show details, aggregate costs, search across
  specs.
- **Audience:** ridgeline operators (the people running `ridgeline ...
  --auto`) who want fast answers without opening five JSON files in an
  editor.
- **Non-audience:** end users of the apps ridgeline produces. People who
  want to *modify* build state — this tool is strictly read-only.

## Scope

### In scope

- Four subcommands: `ls`, `show`, `costs`, `search`.
- Read-only access to `.ridgeline/builds/<name>/{state.json,
  budget.json, trajectory.jsonl, spec.md, learnings.md, phases/*.md}`
  and project-level `.ridgeline/learnings.md`.
- `.ridgeline` is located by walking up from `cwd` until found; an
  explicit `--dir <path>` flag overrides discovery.
- Pretty-printed terminal output by default, with a `--json` flag on
  every command for machine-readable output (one JSON document per
  invocation, written to stdout).
- Graceful handling of missing or partially corrupt artifacts — warn on
  stderr, continue with what's available, never crash the whole run for
  one bad file.
- Single binary published as an npm package, runnable via `npx
  ridgeline-inspect <command>` and installable globally.

### Out of scope

- Writing, editing, or deleting any file inside `.ridgeline/`.
- Network calls of any kind.
- A TUI / interactive mode. This is one-shot output per invocation.
- A web UI (ridgeline already has `ridgeline ui` for that).
- Watching / tailing — no `--follow`. Use `tail -f trajectory.jsonl` if
  you want that.
- Cross-project aggregation (multiple `.ridgeline` dirs in one run).

## Subcommands

### `ridgeline-inspect ls`

List all builds under `.ridgeline/builds/`. Default columns: name,
status, phases (passed/total), total cost (USD), last activity (relative
time, e.g. "3h ago").

Status is derived from `state.json`:
- `passed` — all phases completed and reviewer-passed
- `failed` — at least one phase exhausted retries
- `in-progress` — has a non-terminal phase
- `unknown` — `state.json` missing or unreadable

Flags:

| Flag | Default | Behavior |
|------|---------|----------|
| `--status <s>` | all | Filter to one status (`passed`, `failed`, `in-progress`, `unknown`) |
| `--sort <k>` | `recent` | Sort key: `recent`, `cost`, `name` |
| `--limit <n>` | unlimited | Show only the top N rows after sort |
| `--json` | off | Emit a JSON array instead of a table |

### `ridgeline-inspect show <name>`

Full detail on one build. Sections, in order:

1. Header: name, status, total cost, total wall-clock duration.
2. Spec summary: the first `## Goals` (or first H2) section of
   `spec.md`, truncated to ~20 lines with a "(truncated, see spec.md)"
   marker if longer.
3. Phase table: phase number, slug, status, retries, cost, duration.
4. Last 10 trajectory events: timestamp, event type, phase (if any), one
   short message.
5. Failure tail (only if `status === failed`): the most recent
   `<phase>.feedback.md` excerpt, first 30 lines.

`<name>` resolves by exact match first, then case-insensitive prefix
match if exactly one build prefix-matches. Multiple matches → error
with the candidate list.

Flags:

| Flag | Default | Behavior |
|------|---------|----------|
| `--json` | off | Emit a single JSON object with all of the above |

### `ridgeline-inspect costs`

Cost aggregation across builds. Default: a single table grouped by
build, columns `build`, `phases`, `cost`, `last activity`, summed total
at the bottom.

Flags:

| Flag | Default | Behavior |
|------|---------|----------|
| `--by <k>` | `build` | Group by `build`, `stage`, or `model` |
| `--since <window>` | all time | Window like `7d`, `24h`, `30d` (relative to now) |
| `--top <n>` | unlimited | Show only the top N rows by cost |
| `--json` | off | Emit grouped JSON |

Source: per-invocation entries in `budget.json`. If `budget.json` is
missing for a build, count it as `$0` and continue (do not skip the
build from other reports).

### `ridgeline-inspect search <query>`

Substring search (case-insensitive) across `spec.md`, `learnings.md`,
and `phases/*.md` of every build under `.ridgeline/builds/`. Output is
grouped by build, then by file, with one snippet per match (the
matching line plus one line of context above and below). Truncate at
the first 5 matches per file with a `(N more)` marker.

Query is treated as a literal substring — no regex, no glob. Quoting is
the shell's job.

Flags:

| Flag | Default | Behavior |
|------|---------|----------|
| `--in <files>` | all | Comma-separated list of `spec`, `learnings`, `phases` |
| `--json` | off | Emit a list of `{build, file, line, snippet}` objects |

## User Flows (Golden Path)

1. Operator finishes a long `--auto` run. They cd into the project and
   run `ridgeline-inspect ls`. They see the new build at the top with a
   green `passed` status, $4.12 total cost, and 5 of 5 phases.
2. They run `ridgeline-inspect show focus-timer`. They get the spec
   summary, the phase breakdown, and the last few events confirming the
   reviewer passed.
3. A week later they run `ridgeline-inspect costs --since 7d --by
   stage`. They see that `build` (the implementation stage) is 70% of
   spend, planning is 15%, research is 10%, the rest is small.
4. They want to find every build that mentioned the word "fascicle".
   `ridgeline-inspect search fascicle` returns three builds with line
   snippets so they can jump to the right files.
5. CI script: `ridgeline-inspect ls --status failed --json | jq
   '.[] .name'` lists names of failed builds for a notification step.

## Acceptance Criteria (MUST-PASS)

The reviewer agent treats these as blocking.

- All four commands run on a freshly-cloned project that has at least
  one passed build, one failed build, and one in-progress build in
  `.ridgeline/builds/`. (The test fixture provides these.)
- A build whose `state.json` is missing or invalid JSON appears in `ls`
  with status `unknown`, and `show` on it prints the header + a clear
  "state.json missing or unreadable" warning, then exits 0.
- A build whose `budget.json` is missing contributes `$0` to `costs`
  output and is not silently dropped from `ls`.
- `--json` output for every command is a single valid JSON document on
  stdout; nothing else (warnings, progress) goes to stdout in that
  mode. Warnings go to stderr.
- Exit codes: `0` success, `1` user error (unknown build, ambiguous
  prefix, invalid `--since` value), `2` internal error (unexpected
  exception). Document this in the README.
- `.ridgeline` discovery walks up from `cwd` to filesystem root. If not
  found and `--dir` not given, exit 1 with a message telling the user
  to cd into a ridgeline project or pass `--dir`.
- All terminal output is plain ASCII when `process.stdout.isTTY` is
  false or `NO_COLOR` is set in the environment. Color and Unicode box
  drawing only when both `isTTY` and no `NO_COLOR`.
- Tested against a fixture `.ridgeline/` directory checked in under
  `test/fixtures/`. The fixture covers: passed build, failed build,
  in-progress build, build with missing `state.json`, build with
  malformed `budget.json`. Every code path that handles these has a
  unit or integration test.
- No file under `.ridgeline/` is opened for writing at any point. Tests
  assert this by snapshotting the fixture directory's content hashes
  before and after each command run.

## Technical Constraints

- **Language:** TypeScript, strict mode. Targets Node 20+.
- **Runtime dependencies:** zero. Use `node:util.parseArgs` for argument
  parsing and `node:fs/promises` for IO. ANSI color via a small
  hand-rolled helper that respects `NO_COLOR` and `isTTY`. Table
  formatting hand-rolled — pad columns to the widest cell, no fancy box
  art unless TTY.
- **Dev dependencies:** `vitest` for tests, `typescript`, `oxlint`,
  `tsx` for local dev runs.
- **Package layout:** `src/` for source, `dist/` is the compiled
  output, `bin/ridgeline-inspect` is a tiny shim that requires the
  compiled entry. `package.json` exposes a `bin` entry so `npm install
  -g` works and so does `npx ridgeline-inspect`.
- **Persistence:** none. The tool is stateless.
- **Tests:** `vitest`, with a fixture `.ridgeline/` directory under
  `test/fixtures/`. Cover each subcommand's happy path, each
  graceful-degradation path called out in acceptance criteria, and the
  argument parser. Aim for branch coverage on the readers (state /
  budget / trajectory loaders).
- **Check command:** `npm run typecheck && npm run lint && npm run
  test && npm run build`. Wire all four into `package.json` scripts.
- **Lint:** oxlint with the project's defaults. No `any`, no unused
  vars, no `console.log` in shipped code (use a `log` helper that
  routes to stdout/stderr explicitly).
- **No network.** A test runs the CLI under a process where DNS is
  guaranteed unused (e.g., asserting no `fetch` / `http` /
  `https` / `dns` module is loaded by inspecting `require.cache` or
  by using a minimal smoke test). If that's brittle, settle for a code
  search assertion in the test suite.

## Architecture Notes

A reasonable shape (the planner can deviate with reason):

```text
src/
├── cli.ts              // entry; parses argv, dispatches to a command
├── commands/
│   ├── ls.ts
│   ├── show.ts
│   ├── costs.ts
│   └── search.ts
├── readers/
│   ├── discover.ts     // find .ridgeline by walking up
│   ├── builds.ts       // enumerate builds dir
│   ├── state.ts        // load/parse state.json with fallbacks
│   ├── budget.ts       // load/parse budget.json with fallbacks
│   ├── trajectory.ts   // stream-parse trajectory.jsonl
│   └── text.ts         // load spec/learnings/phase markdown
├── format/
│   ├── table.ts        // hand-rolled column formatter
│   ├── color.ts        // ANSI helpers, NO_COLOR/isTTY aware
│   └── time.ts         // relative time, --since parsing
└── util/
    ├── log.ts          // stdout vs stderr routing
    └── errors.ts       // typed exit codes
test/
├── fixtures/.ridgeline/...
├── ls.test.ts
├── show.test.ts
├── costs.test.ts
├── search.test.ts
└── readers.test.ts
bin/
└── ridgeline-inspect   // node ./dist/cli.js
```

Reader functions return tagged results — `{ ok: true, value }` or `{ ok:
false, reason }` — rather than throwing on missing/corrupt files. The
command layer decides how to surface each `not ok`. This is the
"graceful degradation" requirement made structural.

## Risks & Things To Get Right

- **Don't trust schemas.** `state.json` and `budget.json` are written
  by ridgeline today, but their shape can drift. Validate fields
  defensively at the reader boundary; emit warnings, don't crash.
- **Big trajectory files.** `trajectory.jsonl` can be megabytes. Stream
  it line-by-line; never load whole. For `show`, only the *last* 10
  events are needed — read from the end if practical, otherwise stream
  through with a ring buffer of size 10.
- **`--since` parsing.** Accept `Nd`, `Nh`, `Nm`. Reject anything else
  with a clear error. Don't try to be clever (no "yesterday", no
  "last week").
- **Prefix-match ambiguity.** Be strict: exact match wins always; if
  exact fails, prefix-match must yield exactly one candidate or it's an
  error listing the candidates.
- **JSON-mode purity.** A single misplaced `console.log` ruins a
  pipeline. The `log` helper enforces stream routing; `--json` mode
  silences any non-error logging.

## Phasing Hint

A reasonable decomposition (the planner will refine):

1. **Scaffold + readers** — TS project, lint/test/typecheck/build wired,
   `discover.ts`, `state.ts`, `budget.ts`, `trajectory.ts`, `text.ts`,
   the tagged-result type, fixture `.ridgeline/` directory, reader unit
   tests.
2. **`ls` and `show`** — argument parser, command dispatch, table
   formatter, color/log helpers, both commands implemented with their
   `--json` modes, integration tests against the fixture.
3. **`costs` and `search`** — `--since` parsing, grouping logic,
   substring search with snippet extraction, both commands' tests.
4. **Polish + ship** — package.json `bin`, README with installation and
   each subcommand's flags, exit-code documentation, final pass on
   error messages, `npm pack` smoke test.

## Done Looks Like

- `npm run check` passes clean.
- `npm pack` produces a tarball; `npm install -g ./*.tgz` puts
  `ridgeline-inspect` on the PATH; `ridgeline-inspect ls` works in any
  directory under a ridgeline project.
- Running every subcommand against the fixture matches the snapshots in
  `test/fixtures/expected/`.
- The fixture directory's file hashes are unchanged after running every
  subcommand against it (read-only invariant).
- A reviewer can clone the repo, run `npm install && npm test`, and
  every test passes on a fresh machine with no network.
