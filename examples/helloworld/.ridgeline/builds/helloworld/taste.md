# Taste

## Code style

- Use a named function declaration (`function greet(name) { ... }`) for the export, not an arrow assigned to a `const` — keeps the name in stack traces
- Use a single `const DEFAULT_NAME = 'world'` constant rather than inlining the default string in two places
- Use template literals for the greeting string: `` `Hello, ${name}!` ``
- Coalesce the input once at the top of `greet` (e.g., `name = name || DEFAULT_NAME`); avoid scattering fallback logic
- Two-space indentation, single quotes, semicolons — match typical Node.js convention
- Keep the entire implementation under ~20 lines

## Comments

- Default to no comments. The code is self-explanatory at this size
- Do not document what `greet` does — the name and one-line body are self-evident
- The `require.main === module` idiom is standard Node.js and does not need a comment

## Tests (if added)

- Use `node:test` and `node:assert/strict` exclusively
- Test file: `hello.test.js` colocated with `hello.js`
- One `test(...)` block per acceptance criterion with a descriptive name
- Exercise the direct-execution path via `child_process.spawnSync('node', ['hello.js'])` and assert on `stdout` and `status`

## Commit format

- Conventional Commits style: `feat: add greet function`, `chore: wire main field`, etc.
