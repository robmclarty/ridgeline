# Phase 1: Hello Module

## Goal

Deliver the complete `helloworld` deliverable as a single CommonJS file `hello.js` at the repository root. The file exposes a pure synchronous `greet` function and, when executed directly via `node hello.js`, prints a single greeting line to stdout and exits cleanly. When imported via `require('./hello')`, the module produces no output.

The `greet` function returns a deterministic greeting string for any provided name. When the argument is missing, `null`, `undefined`, or an empty string, it falls back to `world`. The function is pure — no I/O at call time. The module exports `greet` via `module.exports = { greet }` so consumers can destructure it, and uses the `require.main === module` idiom to guard direct execution from import-time side effects.

The file should read top-to-bottom as: function definition → export → direct-execution guard, matching the reading order described in `taste.md`.

## Context

This is a single-phase build: the entire deliverable is a ~15-line single-file CommonJS module with zero runtime dependencies. There are no meaningful sub-deliverables to split across phases — the function, export, and direct-execution guard share the same source file and are jointly verified by one check command.

**Brownfield note.** The working tree shows `hello.js` was deleted (visible as `D hello.js` in `git status`) and the prior phase spec was removed. This phase rebuilds `hello.js` from a clean slate at the repository root. No prior `hello.js` content should be assumed; do not attempt to restore from history. The existing `package.json` is unchanged and must remain unchanged — no dependencies, no `"type": "module"`, no new scripts.

`taste.md` (currently untracked) carries style preferences that shape acceptance: under ~20 lines, two-space indentation, single quotes, semicolons, trailing newline, `const` over `let`, template literals for interpolation, no comments unless genuinely non-obvious.

## Acceptance Criteria

1. A file `hello.js` exists at the repository root (alongside `package.json`).
2. No new files or directories are created beyond `hello.js` (no `src/`, `lib/`, `dist/`, test files, or config files).
3. `package.json` is unchanged: no new entries in `dependencies` or `devDependencies`, and no `"type": "module"` field is added.
4. `require('./hello').greet` is a function.
5. `const { greet } = require('./hello')` yields the same function reference as `require('./hello').greet`.
6. `greet('Alice')` returns the exact string `Hello, Alice!`.
7. `greet()` returns the exact string `Hello, world!`.
8. `greet(undefined)` returns the exact string `Hello, world!`.
9. `greet(null)` returns the exact string `Hello, world!`.
10. `greet('')` returns the exact string `Hello, world!`.
11. `typeof greet('Alice') === 'string'`, and `greet` does not throw for any of the inputs in criteria 6–10.
12. Calling `greet` performs no I/O: no writes to stdout or stderr occur during a `require('./hello'); greet('x')` invocation.
13. Loading the module via `require('./hello')` produces no output on stdout or stderr at load time (the direct-execution guard suppresses output on import).
14. Running `node hello.js` prints exactly the bytes `Hello, world!\n` to stdout (verifiable via `node hello.js | wc -c` returning `14`).
15. Running `node hello.js` exits with status code 0.
16. The source of `hello.js` contains the literal string `require.main === module` (the spec-mandated direct-execution idiom).
17. The source of `hello.js` uses `module.exports = { greet }` (object form, supporting destructuring).
18. Source ordering in `hello.js` is: function definition first, then export, then direct-execution guard.
19. `hello.js` is under 20 non-blank lines, uses two-space indentation, single quotes, semicolons, and ends with a trailing newline.
20. The check command from `constraints.md` exits with status 0 when run from the repository root.

## Spec Reference

From `spec.md`:

- **Greeting function** — pure `greet(name)` returning a string; falls back to `world` for missing/`null`/`undefined`/empty input; performs no I/O.
- **Direct execution** — `node hello.js` prints exactly `Hello, world!\n` and exits 0; importing produces no output; uses `require.main === module`.
- **Module export** — `module.exports = { greet }` so destructuring works.

From `constraints.md`:

- CommonJS, Node.js >= 18, flat layout (single file at repo root), zero dependencies.
- Function name `greet`, file name `hello.js`, `camelCase` throughout.
- Output uses `console.log(...)` so the trailing newline is implicit.
- Check command runs both function-level assertions and a stdout match for `node hello.js`.

From `taste.md`:

- Under ~20 lines; two-space indent; single quotes; semicolons; `const` only; template literals for interpolation; no comments; trailing newline.
- Reading order: function → export → guard.
