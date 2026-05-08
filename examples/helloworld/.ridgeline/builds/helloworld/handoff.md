## Phase 1: Hello Module

### What was built
- `hello.js` at the repository root: a 7-line CommonJS module containing the pure `greet` arrow function, a destructurable `module.exports = { greet }`, and a `require.main === module` direct-execution guard that prints `Hello, world!`.

### Decisions
- Used the `name || 'world'` short-circuit fallback because it covers all four nullish/empty inputs (`undefined`, `null`, `''`, missing) in a single expression and keeps the file under the ~20-line ceiling. The check command and a separate spawn-based check confirm it returns `Hello, world!` for each.
- Implemented `greet` as a `const` arrow function rather than a `function` declaration to lean into the taste preference for `const` and template literals while keeping the function-definition-first reading order intact.
- Did not declare a CLI argv path — the spec explicitly excludes `process.argv` parsing, so direct execution simply calls `greet()` with no arguments.

### Deviations
- None. `package.json` is unchanged, no new files beyond `hello.js`, and the constraints check command exits 0.

### Notes for next phase
- This is a single-phase build; there is no next phase. The reviewer should run the constraints check command from the repo root and inspect `hello.js` for the function → export → guard reading order.
