## Phase 1: Hello module and package wiring

### What was built
- `hello.js` at project root: 14-line CommonJS module exporting `{ greet }`. Uses a named function declaration, a `DEFAULT_NAME = 'world'` constant, template literals, and `name = name || DEFAULT_NAME` to coalesce omitted/undefined/empty inputs in one place. Direct-run block (`if (require.main === module) { console.log(greet()); }`) prints `Hello, world!\n` to stdout when invoked via `node hello.js`.
- `package.json`: added `"main": "hello.js"`. No dependencies, devDependencies, or scripts added. No `"type": "module"`.

### Decisions
- Included `'use strict';` directive at the top — harmless for CommonJS, costs no lines toward the ~20-line budget, and is a common Node.js convention. Not required by spec but not prohibited.
- Used `name = name || DEFAULT_NAME` (truthy coalescing) rather than `name ?? DEFAULT_NAME` because the spec requires empty string `''` to fall back to `'world'`, and `||` handles `''`, `undefined`, and omitted args in one expression. Matches taste.md guidance to "coalesce the input once at the top".
- No tests written — taste.md presents tests as optional ("if added"), and the binding check command from constraints.md fully exercises the acceptance gates.

### Deviations
- None. All 15 acceptance criteria verified passing (binding check exits 0; explicit byte-level verification of `node hello.js` stdout = `Hello, world!\n`, stderr empty, exit 0; `require('./hello')` produces zero bytes on stdout/stderr at load time).

### Notes for next phase
- This is the terminal phase — the entire project is delivered. No follow-up phase expected.

