# Constraints

## Language and runtime

- Language: JavaScript (ES2020+ syntax compatible with the target Node runtime)
- Module system: CommonJS (`module.exports`, `require`). Do not use ESM (`import`/`export`) and do not add `"type": "module"` to `package.json`
- Runtime: Node.js >= 18 (LTS). The script must run under stock Node with no flags

## Directory layout

- Flat layout: source file `hello.js` at the project root
- No `src/`, `dist/`, or `lib/` directories — overkill for a single file
- Tests, if added, live in `__tests__/` or as sibling `*.test.js` files

## Naming

- File name: `hello.js` (lowercase, no separators)
- Function name: `greet` (camelCase)
- Boolean variables, if any, use `is`/`has`/`should` prefixes

## API style

- Export shape: `module.exports = { greet }` (object-shaped export, not bare-function default)
- Direct-execution guard: `if (require.main === module) { ... }` at the bottom of the file
- Output channel for the script path: `console.log(greet())` (relies on `console.log`'s trailing newline)

## Dependencies

- Zero runtime dependencies
- Zero dev dependencies beyond what is already declared in `package.json`
- If tests are added, use Node's built-in `node:test` and `node:assert/strict` — no Jest, Mocha, Chai, or other framework

## Package metadata

- `package.json` `main` field must be `"hello.js"`
- No `bin` entry, no shebang line
- No additional npm scripts beyond what is required by the check command

## Check Command

```
node -e "const { greet } = require('./hello'); if (greet('Alice') !== 'Hello, Alice!') process.exit(1); if (greet() !== 'Hello, world!') process.exit(1); if (greet('') !== 'Hello, world!') process.exit(1);" && test "$(node hello.js)" = "Hello, world!"
```
