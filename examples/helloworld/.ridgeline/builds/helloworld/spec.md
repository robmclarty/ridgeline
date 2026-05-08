# helloworld

## Overview

A single-file Node.js (CommonJS) module that exports a reusable `greet` function and, when executed directly via `node hello.js`, prints a greeting to standard output. The module has no runtime dependencies and no build step. It works in two modes: as an importable library (no side effects on require) and as a standalone script (prints and exits 0).

## Features

### Reusable greeting function

The module defines a function `greet(name)` that returns a greeting string. When `name` is a non-empty string, it returns `Hello, <name>!`. When `name` is omitted, `undefined`, or an empty string, it returns `Hello, world!`. The function performs no I/O, does not throw, and always returns a string.

**Acceptance criteria:**
- `require('./hello').greet('Alice')` returns the exact string `Hello, Alice!`
- `require('./hello').greet()` returns the exact string `Hello, world!`
- `require('./hello').greet('')` returns the exact string `Hello, world!`
- `require('./hello').greet(undefined)` returns the exact string `Hello, world!`
- `typeof require('./hello').greet` is `'function'`
- Calling `greet` produces no output on stdout or stderr
- `greet` does not throw for any of the inputs above

### Direct-execution entry point

When the file is executed directly via `node hello.js`, it writes a greeting to stdout terminated by a single newline and exits with status code 0. The direct-run block is gated by the `require.main === module` idiom so that requiring the module produces no output.

**Acceptance criteria:**
- `node hello.js` writes exactly the bytes `Hello, world!\n` to stdout
- `node hello.js` exits with status code 0
- `node hello.js` writes nothing to stderr
- `require('./hello')` produces no stdout or stderr output at load time
- The direct-run block is wrapped in `if (require.main === module) { ... }`

### Module export and package wiring

The module exports the `greet` function via CommonJS so it can be consumed as `const { greet } = require('./hello')`. The `package.json` `main` field points to the script file so the module resolves without additional configuration.

**Acceptance criteria:**
- `require('./hello')` returns an object with a `greet` property
- `const { greet } = require('./hello')` yields a callable function
- `package.json` contains a `main` field whose value is `hello.js`
- The path in `main` resolves to the source file in the repository
- `package.json` declares zero runtime dependencies

## Scope

**In scope:**
- A single JavaScript source file `hello.js` at the project root
- CommonJS module syntax (`module.exports`, `require`)
- A `greet(name)` function with default fallback to `world`
- Direct-execution behavior gated by `require.main === module`
- `package.json` `main` field pointing at `hello.js`

**Out of scope:**
- Command-line argument parsing (no `node hello.js Alice` behavior required)
- TypeScript, transpilation, or any build step
- ESM (`import`/`export`) syntax or `"type": "module"` in `package.json`
- External runtime dependencies
- Internationalization or locale handling
- Logging frameworks, configuration files, or environment-variable handling
- Publishing to npm, `bin` entries, or shebang lines
- Linting/formatting toolchain configuration
