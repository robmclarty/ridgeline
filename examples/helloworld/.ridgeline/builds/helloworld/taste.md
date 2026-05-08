# Taste

## Code style

- Keep the entire implementation under ~20 lines.
- Two-space indentation, single quotes, semicolons, trailing newline at end of file.
- Prefer `const` over `let`; never use `var`.
- Use template literals (`` `Hello, ${name}!` ``) for string interpolation rather than concatenation.

## Reading order

The file should read top-to-bottom as: function definition → export → direct-execution guard. A reader scanning the file should see the `greet` function first, since it is the concept being demonstrated.

## Comments

Default to no comments. The code is small enough and the names descriptive enough that comments would be noise. Do not add a file-header comment, JSDoc block, or "why" comments unless the behavior is genuinely non-obvious.

## Tests

No test framework. The check command's inline `node -e` assertions are the verification surface. If tests are ever added, prefer the built-in `node:test` over external frameworks to preserve the zero-dependency posture.
