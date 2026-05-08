# Constraints

## Language and Runtime

- JavaScript (ES2020+ syntax compatible with Node.js 18+).
- Node.js >= 18 LTS.
- CommonJS module system. Do not introduce `"type": "module"` in `package.json`.

## Layout

- Flat layout: a single source file `hello.js` at the repository root, alongside the existing `package.json`.
- No `src/`, `lib/`, or `dist/` directories.

## Naming

- `camelCase` for functions and variables.
- The exported greeting function MUST be named `greet`.
- File name is lowercase: `hello.js`.
- Booleans (if introduced) use `is`/`has`/`should` prefixes.

## API Style

- CommonJS exports via `module.exports = { greet }` so destructuring works (`const { greet } = require('./hello')`).
- The function signature is `greet(name?: string): string` — synchronous and pure.
- Direct-execution detection uses `require.main === module`.
- Output uses `console.log(...)` so the trailing newline is implicit.

## Dependencies

- Zero runtime dependencies. Do not add anything to `dependencies` or `devDependencies`.

## Check Command

```
node -e "const { greet } = require('./hello'); if (greet('Alice') !== 'Hello, Alice!') process.exit(1); if (greet() !== 'Hello, world!') process.exit(1); if (greet('') !== 'Hello, world!') process.exit(1); if (greet(null) !== 'Hello, world!') process.exit(1);" && test "$(node hello.js)" = "Hello, world!"
```
