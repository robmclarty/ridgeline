---
depends_on: [01-foundation-baseline]
---

# Phase 2: Sandbox policy builder

## Goal

Replace `src/engine/claude/sandbox.greywall.ts` with
`src/engine/claude/sandbox.policy.ts`, exporting a single function
`buildSandboxPolicy(args)` that maps ridgeline's `--sandbox` flag values
(`off | semi-locked | strict`) to fascicle's
`SandboxProviderConfig | undefined` shape with no widening of the existing
network or filesystem allowlists. Reduce `sandbox.ts` and `sandbox.types.ts`
to detection helpers and config types — strip out spawn-wrapping behavior.

This phase intentionally lands BEFORE the engine factory phase: the engine
factory's unit tests assert that
`providers.claude_cli.sandbox.kind === 'greywall'` for `'semi-locked'` and
`'strict'` flag values, and that test depends on `buildSandboxPolicy` being
available to import. By landing sandbox policy first, the factory phase has
no stopgap to maintain.

By phase exit, all pre-existing greywall integration tests pass unmodified,
and a new sandbox-parity regression test asserts policy enforcement matches
the legacy spawn wrapper for at least one network-blocked and one
filesystem-blocked scenario.

## Context

Pre-migration ridgeline enforces sandboxing by spawn-wrapping the Claude
subprocess inside a greywall (or bwrap) jail configured at process-launch
time. Fascicle's `claude_cli` provider owns the spawn lifecycle, so the
policy must be expressed as a `SandboxProviderConfig` object that fascicle
applies — not as a wrapping shell command.

The pre-migration default network allowlists for `'semi-locked'` and
`'strict'` are recorded as fixture snapshots in
`.ridgeline/builds/fascicle-migration/baseline/sandbox-allowlist.<flag>.json`
(captured in Phase 1). Those snapshots are the source of truth: the policy
builder must yield byte-equal allowlist arrays.

`buildPath` (the absolute path to the build's
`.ridgeline/builds/<name>/` directory) is always present in the policy's
`additional_write_paths`.

## Acceptance Criteria

1. `src/engine/claude/sandbox.policy.ts` exists; exports
   `buildSandboxPolicy(args): SandboxProviderConfig | undefined`.
2. `src/engine/claude/sandbox.greywall.ts` does NOT exist after this phase
   (verified by `ls`).
3. `buildSandboxPolicy` returns `undefined` when `args.sandboxFlag === 'off'`,
   and returns `{ kind: 'greywall', network_allowlist, additional_write_paths }`
   for `'semi-locked'` and `'strict'`. Both return shapes are unit-tested.
4. The default `network_allowlist` for `'semi-locked'` is exported as a
   `const` and a unit test asserts it deep-equals
   `.ridgeline/builds/fascicle-migration/baseline/sandbox-allowlist.semi-locked.json`.
   The default `network_allowlist` for `'strict'` is exported as a `const` and
   a unit test asserts it deep-equals
   `.ridgeline/builds/fascicle-migration/baseline/sandbox-allowlist.strict.json`.
   No new entries are introduced in either allowlist.
5. `additional_write_paths` always contains `buildPath`. A unit test asserts
   the resolution is per-build (different `buildPath` inputs produce
   different resolved paths) and that no extra paths beyond the documented
   set are present.
6. Every greywall integration test name listed in
   `.ridgeline/builds/fascicle-migration/baseline/greywall-tests.txt`
   continues to pass with zero modifications to the test code itself.
7. A new sandbox-parity regression test under `src/engine/__tests__/`
   asserts that `buildSandboxPolicy({ sandboxFlag: 'semi-locked', buildPath })`
   yields equivalent runtime enforcement to the legacy spawn wrapper for at
   minimum: (a) one network-blocked scenario (a host outside the allowlist
   is rejected); (b) one filesystem-blocked scenario (a write outside
   `additional_write_paths` is rejected).
8. `src/engine/claude/sandbox.ts` and `src/engine/claude/sandbox.types.ts`
   are reduced to detection helpers and config types only. An ast-grep rule
   in `.ast-grep/` (or wherever existing rules live) flags any
   `child_process` or `spawn` import in those two files; adding such an
   import fails `npm run check`.
9. `npm run check` exits with zero status; `.check/summary.json` shows zero
   failures across all tools.
10. `ridgeline build` runs end-to-end with default sandbox enforcement (still
    on the old pipeline; the engine factory has not yet been migrated).
11. `.ridgeline/builds/fascicle-migration/phase-2-check.json` exists and is a
    verbatim copy of `.check/summary.json` at this phase's exit commit.

## Spec Reference

From `spec.md`, "Phase 2 — Sandbox policy builder and greywall parity":
> Replace src/engine/claude/sandbox.greywall.ts with
> src/engine/claude/sandbox.policy.ts exporting
> `buildSandboxPolicy(args): SandboxProviderConfig | undefined`. The function
> maps `--sandbox` flag values (`off | semi-locked | strict`) to fascicle's
> `{ kind: 'greywall', network_allowlist, additional_write_paths }` shape
> with no widening.

From `constraints.md`, "Sandbox Policy":
> Greywall enforcement is non-negotiable: existing greywall integration
> tests pass at Phase 2 exit with zero modifications.
> `auth_mode: 'auto'` preserves subscription/OAuth path; `ANTHROPIC_API_KEY`
> is not required.
