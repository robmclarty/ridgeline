# Phase 3: Sandbox Policy Builder and Greywall Parity

## Goal

Replace ridgeline's hand-rolled spawn-wrapping greywall sandbox with a configuration builder that produces fascicle's `SandboxProviderConfig`. The new `buildSandboxPolicy(args)` function in `src/engine/claude/sandbox.policy.ts` maps `--sandbox` flag values (`off | semi-locked | strict`) to either `undefined` (for `off`) or `{ kind: 'greywall', network_allowlist, additional_write_paths }`, with zero widening of network or filesystem allowances relative to the pre-migration spawn wrapper.

Greywall enforcement is non-negotiable: every greywall integration test enumerated in `.ridgeline/builds/fascicle-migration/baseline/greywall-tests.txt` must pass at this phase's exit with zero modifications to the test files themselves. If a test would need adjustment, that signals a policy-builder bug, not a stale test. The default `network_allowlist` for `semi-locked` and `strict` is exported as a named `const` and snapshot-tested for byte equality against the Phase 1 baseline allowlist files; any new entry requires an explicit code-comment justification.

`sandbox.ts` and `sandbox.types.ts` are reduced to detection helpers and config types only — they no longer wrap `child_process` or `spawn` directly because fascicle's `claude_cli` provider owns subprocess spawn now. `sandbox.greywall.ts` is deleted at this phase exit.

## Context

Phase 2 landed the adapter layer. This phase replaces the security-critical sandbox layer in isolation, before the engine factory (Phase 6) is built. The engine factory will consume `buildSandboxPolicy(args)` to produce the `claude_cli` provider's sandbox config; landing the policy builder in its own phase means reviewers can audit a single contained PR for the sandbox change without mixed concerns.

The legacy `sandbox.greywall.ts` spawn wrapper currently runs the greywall enforcement; after this phase, fascicle's `claude_cli` provider will own that enforcement using the policy this builder produces. No commands consume the new policy yet — it is unit-tested in isolation and verified against the legacy spawn wrapper's behavior via a parity regression test. The legacy pipeline still runs every command end-to-end at the phase exit.

## Acceptance Criteria

1. `src/engine/claude/sandbox.policy.ts` exists and exports `buildSandboxPolicy(args: { sandboxFlag: 'off' | 'semi-locked' | 'strict', buildPath: string, networkAllowlistOverrides?: string[], additionalWritePaths?: string[] }): SandboxProviderConfig | undefined`.
2. `src/engine/claude/sandbox.greywall.ts` does not exist on disk at this phase exit (verified by file-presence check).
3. Unit test: `buildSandboxPolicy({ sandboxFlag: 'off', buildPath, ... })` returns `undefined`.
4. Unit test: `buildSandboxPolicy({ sandboxFlag: 'semi-locked', buildPath, ... })` returns `{ kind: 'greywall', network_allowlist, additional_write_paths }` where `network_allowlist` matches the exported `const` and `additional_write_paths` includes `buildPath`.
5. Unit test: `buildSandboxPolicy({ sandboxFlag: 'strict', buildPath, ... })` returns `{ kind: 'greywall', network_allowlist, additional_write_paths }` where `network_allowlist` matches the exported `const` for strict mode (which is a subset of, or equal to, semi-locked per the legacy semantics).
6. The default `network_allowlist` arrays for `semi-locked` and `strict` are exported as named `const` values and snapshot-tested for byte equality against `.ridgeline/builds/fascicle-migration/baseline/sandbox-allowlist.semi-locked.json` and `.../sandbox-allowlist.strict.json` respectively. Any new entry compared to baseline requires an explicit code-comment justification adjacent to the allowlist entry; absence of such a justification fails the snapshot test.
7. `buildPath` is always present in `additional_write_paths` (verified by per-build-path unit test using a tmpdir).
8. Unit test: when `networkAllowlistOverrides` is supplied, the override list replaces (or extends, per the documented pre-migration semantics — whichever the legacy spawn wrapper did) the default. The exact legacy semantics are documented in a top-of-file comment in `sandbox.policy.ts`.
9. Unit test: when `additionalWritePaths` is supplied, those paths are merged into the result's `additional_write_paths` along with `buildPath`.
10. Every greywall integration test enumerated in `.ridgeline/builds/fascicle-migration/baseline/greywall-tests.txt` passes unchanged at this phase exit. Verified by running the test suite and confirming each named test appears with passing status; zero test-file modifications are permitted (verified by `git diff` against the pre-Phase-2 `src/engine/__tests__/` directory restricted to greywall test files).
11. A new sandbox-parity regression test in `src/engine/__tests__/sandbox-parity.test.ts` asserts the new policy yields enforcement equivalent to the legacy spawn wrapper for at least one network-blocked scenario (a disallowed host fails the network probe with the same observable error class) and at least one filesystem-blocked scenario (a write to a path outside `additional_write_paths` fails with the same observable error class).
12. `sandbox.ts` and `sandbox.types.ts` are reduced to detection helpers and config types only. Ast-grep rule flags any `child_process` import, `spawn(` call, or `exec(` call in either file; the rule fails `npm run check` if any are present.
13. The `auth_mode: 'auto'` decision is documented in a top-of-file comment in `sandbox.policy.ts` as a related invariant (auth_mode lives in the engine factory's `claude_cli` config, not in the policy builder, but the file flags this for future readers so the OAuth/subscription preservation rationale is visible at the boundary).
14. Ast-grep rule passes: zero `export ... as <camelCaseName>` re-exports of fascicle-snake_case symbols in `sandbox.policy.ts`.
15. Ast-grep rule passes: zero `console.*`, zero `process.stderr/stdout.write`, zero emoji, zero new ANSI escape sequences in `sandbox.policy.ts`.
16. `npm run check` is green.
17. `ridgeline build` runs end-to-end with default sandbox enforcement (still on the old pipeline) and the build's actual filesystem writes and network calls succeed/fail identically to pre-Phase-2 behavior — verified by manual smoke against this build's directory; the smoke command and observed result are recorded in the phase-exit commit body.
18. `.ridgeline/builds/fascicle-migration/phase-2-check.json` captures a green `.check/summary.json` snapshot at the phase-exit commit.
19. The phase exit commit subject begins with `phase-2:`.

## Spec Reference

- spec.md → "Phase 2 — Sandbox policy builder and greywall parity": `buildSandboxPolicy(args)`, deletion of `sandbox.greywall.ts`, reduction of `sandbox.ts`/`sandbox.types.ts` to detection helpers and config types.
- spec.md → "Twelve invariants" — invariant 7 (sandbox enforcement parity), invariant 9 (sandbox allowlist not widened).
- constraints.md → "Sandbox Policy": no widening, `auth_mode: 'auto'`, `buildPath` always present in `additional_write_paths`, greywall integration tests pass unchanged.
- taste.md → "Code Style": prefer `instanceof` checks over regex pattern matching for classification (this phase prepares for that by keeping subprocess concerns out of `sandbox.ts`).
