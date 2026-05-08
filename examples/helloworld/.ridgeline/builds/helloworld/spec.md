# helloworld — Reusable Greeting Script

## Overview

A single-file Node.js (CommonJS) module that exports a pure `greet` function and, when executed directly via `node hello.js`, prints a greeting line to stdout and exits with status 0. The module has zero runtime dependencies and no build step.

## Features

### Greeting function

A pure function `greet(name)` that returns a greeting string. Accepts an optional name; falls back to `world` when the argument is missing, `null`, `undefined`, or an empty string. The function performs no I/O.

Acceptance criteria:
- `greet('Alice')` returns the exact string `Hello, Alice!`.
- `greet()` returns the exact string `Hello, world!`.
- `greet(undefined)`, `greet(null)`, and `greet('')` all return `Hello, world!`.
- The function returns a value of type `string` and does not throw for any input listed above.
- The function performs no I/O at call time (no `console.log`, no `process.stdout.write`).

### Direct execution

When the file is run with `node hello.js`, it prints exactly `Hello, world!` followed by a single newline to stdout and exits with status code 0. Importing the module produces no output.

Acceptance criteria:
- `node hello.js` prints exactly the bytes `Hello, world!\n` to stdout.
- `node hello.js` exits with status code 0.
- `require('./hello')` produces no output on stdout or stderr at load time.
- Direct-execution detection uses the `require.main === module` idiom.

### Module export

The module exports `greet` via CommonJS `module.exports` so consumers can destructure it.

Acceptance criteria:
- `require('./hello').greet` is a function.
- `const { greet } = require('./hello')` yields the same function reference as `require('./hello').greet`.

## In Scope

- A single source file `hello.js` at the project root.
- CommonJS module format (`module.exports = { greet }`).
- Pure synchronous greeting function with fallback for nullish/empty `name`.
- Direct execution via `node hello.js`.
- Zero runtime dependencies.

## Out of Scope

- CLI argument parsing (reading a name from `process.argv`).
- Reading a name from environment variables or stdin.
- ESM (`import`/`export`) module format or `"type": "module"` in `package.json`.
- TypeScript or any build/transpile step.
- External dependencies (chalk, commander, dotenv, etc.).
- Test framework setup (Jest, Mocha, `node:test`).
- Linter or formatter configuration.
- A shebang line or `package.json` `bin` entry.
- Localization, i18n, or alternative greeting templates.
- Defensive coercion of non-string `name` arguments (numbers, objects).
