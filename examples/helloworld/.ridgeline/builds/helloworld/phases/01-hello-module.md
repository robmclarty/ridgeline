# Phase 1: Hello module and package wiring

## Goal

Deliver the complete helloworld module as a single, self-contained CommonJS file at the project root, plus the `package.json` wiring that lets it be required without additional configuration. The deliverable is the entire project: a working module that behaves correctly in two modes — as an importable library exposing a pure `greet(name)` function with no side effects on require, and as a standalone script that prints a greeting to stdout when executed directly via `node hello.js`.

The `greet` function returns `Hello, <name>!` for non-empty string inputs and `Hello, world!` when `name` is omitted, `undefined`, or an empty string. It performs no I/O, never throws for the supported input shapes, and always returns a string. When the file is run directly, it writes exactly `Hello, world!\n` to stdout and exits with status 0. The direct-run block is gated by `if (require.main === module) { ... }` so that requiring the module produces no output.

The `package.json` `main` field must point at `hello.js` so consumers resolve the module without specifying anything beyond the project. Zero runtime dependencies are introduced. The phase is complete when the check command from `constraints.md` exits with status 0 — that command is the single binding acceptance gate and exercises both the library API (three input variants) and the direct-execution path (exact stdout content).

## Context

This is a brownfield situation that is effectively a clean slate from a code perspective. The git working tree shows `hello.js` was deleted (status `D hello.js`), the prior `phases/01-hello-module.md` was deleted, and there is a prior builder attempt commit `f5041e4 ridgeline: builder work for 01-hello-module (attempt 1)` in history. Treat this phase as a fresh build: do not attempt to restore the deleted file from git, and do not assume any prior implementation persists. Re-create `hello.js` from scratch according to the acceptance criteria below.

The `package.json` to edit is the **local** one at `examples/helloworld/package.json` (the project root for this build). Its current contents are:

```json
{
  "name": "helloworld",
  "version": "1.0.0"
}
```

It has no `main` field, no `dependencies`, no `devDependencies`, and no `scripts`. Add only the `main` field — do not add scripts, dependencies, or other fields the spec does not require. Do not edit the repository-root `package.json`; it is unrelated to this build.

The total surface area is a ~20-line CommonJS source file plus a one-field `package.json` edit. A Node.js runtime (>= 18) is required to execute the check command; the harness sandbox provides this.

## Acceptance Criteria

1. A file named `hello.js` exists at the project root (the directory containing this build's `package.json`).
2. `require('./hello')` returns an object exposing a `greet` property whose `typeof` is `'function'`.
3. `const { greet } = require('./hello')` yields a callable function (i.e., the export shape is `module.exports = { greet }`, object-shaped).
4. `require('./hello').greet('Alice')` returns the exact string `Hello, Alice!`.
5. `require('./hello').greet()` returns the exact string `Hello, world!`.
6. `require('./hello').greet(undefined)` returns the exact string `Hello, world!`.
7. `require('./hello').greet('')` returns the exact string `Hello, world!`.
8. Calling `greet` with any of the inputs above produces no writes to stdout or stderr and does not throw.
9. Requiring the module (e.g., `node -e "require('./hello')"`) produces zero bytes on stdout and zero bytes on stderr at load time.
10. Running `node hello.js` writes exactly the bytes `Hello, world!\n` to stdout, writes nothing to stderr, and exits with status 0.
11. The direct-execution behavior in `hello.js` is gated by an `if (require.main === module) { ... }` block so requiring the module does not trigger it.
12. `package.json` (at the helloworld project root, not the repository root) contains a `main` field whose value is the exact string `"hello.js"`, and the referenced path resolves to the source file.
13. `package.json` declares zero runtime dependencies (no `dependencies` block, or an empty one) and introduces no new dev dependencies.
14. No ESM syntax is used in `hello.js` and `package.json` does not declare `"type": "module"`.
15. The check command from `constraints.md` (the fenced block under `## Check Command`) exits with status 0 when run from the project root. This is the single binding gate — if it fails, the phase fails.

## Spec Reference

All three feature sections of `spec.md` are in scope for this phase:

- **Reusable greeting function** — `greet(name)` returns `Hello, <name>!` for non-empty strings, `Hello, world!` for omitted/`undefined`/empty inputs; pure, no I/O, never throws.
- **Direct-execution entry point** — `node hello.js` writes `Hello, world!\n` to stdout, exits 0, gated by `require.main === module`.
- **Module export and package wiring** — CommonJS object-shaped export `module.exports = { greet }`; `package.json` `main` field set to `hello.js`; zero runtime dependencies.

`constraints.md` governs language (CommonJS, no ESM), runtime (Node >= 18), naming (`hello.js`, `greet`), and provides the binding check command. `taste.md` recommends a named function declaration, a `DEFAULT_NAME` constant, template literals, two-space indentation, single quotes, and no comments — apply these to keep the file under ~20 lines.
