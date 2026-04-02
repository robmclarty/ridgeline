# Phase 1: Hello Script

## Goal

Create the core hello world script that provides a reusable greeting function and serves as a standalone executable. When run directly, it should print a greeting to stdout. When imported as a module, it should expose the greeting function for use by other code.

## Context

The project is a minimal Node.js repository with only a `package.json` in place. No source files exist yet.

## Acceptance Criteria

1. A file `hello.js` exists in the project root.
2. Running `node hello.js` prints exactly `Hello, World!` to stdout.
3. The file exports a `greet` function such that `require("./hello").greet("Alice")` returns the string `"Hello, Alice!"`.
4. The `greet` function is not invoked on import — only when the script is run directly.
5. The script uses no external dependencies.

## Spec Reference

- Defines a function `greet(name)` that returns `"Hello, <name>!"`.
- Exports the function.
- When run directly (not imported), prints `greet("World")` to stdout.
