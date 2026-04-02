
## Phase 1: Hello Script

### What was built
- `hello.js` — Defines `greet(name)` returning `"Hello, <name>!"`, exports it, and prints `greet("World")` when run directly.

### Decisions
- Used `require.main === module` guard to distinguish direct execution from import.

### Deviations
None.

### Notes for next phase
- `hello.js` is both a standalone script and a CommonJS module exposing `{ greet }`.