# Reviewer Feedback: Phase 02-sandbox-policy

## Failed Criteria

### Criterion 9
**Status:** FAIL
**Evidence:** npm run check exits non-zero. summary.json shows agents: ok=false, exit_code=1. Verifier output: 'agnix binary not found. Try reinstalling: npm install -g agnix'. All seven other sub-checks (types, lint, struct, dead, docs, spell, test) pass.
**Required state:** npm run check exits 0 with all eight sub-checks (types, lint, struct, agents, dead, docs, spell, test) reporting ok=true, and phase-2-check.json captures that green summary. The agnix binary must be present at node_modules/agnix/bin/agnix-binary so the agents check can run — pre-stage the binary outside the sandbox before re-running, or invoke npm install in a context where agnix's postinstall download succeeds.

### Criterion 10
**Status:** FAIL
**Evidence:** Handoff does not document a 'ridgeline build runs end-to-end' verification run for this phase. The legacy greywallProvider was preserved in sandbox.policy.ts so the legacy pipeline still has its dependency, but no captured evidence shows ridgeline build was actually exercised end-to-end at this commit.
**Required state:** Either run `ridgeline build` end-to-end at this commit and record evidence (a successful build path, a state.json snapshot, or a brief excerpt) in the handoff, or — at minimum — verify the legacy pipeline still imports greywallProvider from the new location without errors at runtime.

### Criterion 11
**Status:** FAIL
**Evidence:** phase-2-check.json exists at the documented path but its content shows ok:false (because agents failed). The AC requires it be a verbatim copy of .check/summary.json AND that summary show zero failures (per constraints.md 'Each phase-<N>-check.json must show zero failures...'). The artifact correctly mirrors the failing summary, but the failing content itself violates the gate.
**Required state:** phase-2-check.json shows ok=true with every sub-check.ok=true; this is a downstream consequence of fixing the agents failure in AC9 and re-running npm run check.

## Issues

- npm run check fails: agents sub-check returns exit 1 with 'agnix binary not found'. The handoff explains this as environmental — the worktree was prepared by `npm install --ignore-scripts` inside the active sandbox, which left node_modules/agnix/bin/agnix-binary missing, and both fallback recovery paths (GitHub releases via curl, cargo install agnix-cli) are blocked by the active sandbox's network policy. The constraint is non-negotiable: phase-<N>-check.json must show zero failures across all eight tools. (.ridgeline/builds/fascicle-migration/phase-2-check.json)
  - **Required:** npm run check exits 0 with all eight sub-checks (types, lint, struct, agents, dead, docs, spell, test) reporting ok=true, and phase-2-check.json captures that green summary. The agnix binary must be present at node_modules/agnix/bin/agnix-binary so the agents check can run — pre-stage the binary outside the sandbox before re-running, or invoke npm install in a context where agnix's postinstall download succeeds.
- No captured evidence that 'ridgeline build runs end-to-end with default sandbox enforcement' was verified at this phase exit commit. The legacy greywallProvider remains co-located in sandbox.policy.ts (so the legacy pipeline at claude.exec.ts still resolves its imports), but the handoff doesn't document an actual end-to-end run. (.ridgeline/builds/fascicle-migration/handoff-02-sandbox-policy.md)
  - **Required:** Either run `ridgeline build` end-to-end at this commit and record evidence (a successful build path, a state.json snapshot, or a brief excerpt) in the handoff, or — at minimum — verify the legacy pipeline still imports greywallProvider from the new location without errors at runtime.
- phase-2-check.json exists but shows ok:false because of the agents failure. The phase-exit gate requires zero failures. (.ridgeline/builds/fascicle-migration/phase-2-check.json)
  - **Required:** phase-2-check.json shows ok=true with every sub-check.ok=true; this is a downstream consequence of fixing the agents failure in AC9 and re-running npm run check.

## What Passed

- Criterion 1: src/engine/claude/sandbox.policy.ts exists; exports buildSandboxPolicy(args): SandboxProviderConfig | undefined at sandbox.policy.ts:99-121.
- Criterion 2: ls confirms src/engine/claude/sandbox.greywall.ts no longer exists; diff shows the file was deleted.
- Criterion 3: buildSandboxPolicy returns undefined for 'off' (sandbox.policy.ts:102) and { kind: 'greywall', network_allowlist, additional_write_paths } for 'semi-locked' and 'strict' (sandbox.policy.ts:116-120). Verified by sandbox.policy.test.ts tests for all three flag values, all passing.
- Criterion 4: DEFAULT_NETWORK_ALLOWLIST_SEMI_LOCKED and DEFAULT_NETWORK_ALLOWLIST_STRICT exported as frozen const arrays (sandbox.policy.ts:38-65). Both deep-equal baseline JSONs — verified by sandbox.policy.test.ts; verifier confirmed the 16-host array matches both baseline files exactly. No widening.
- Criterion 5: buildPath always at index 0 of additional_write_paths (sandbox.policy.ts:81-87). Per-build resolution and no-extra-paths-beyond-documented-set tests both pass in sandbox.policy.test.ts.
- Criterion 6: All 17 baseline test names from greywall-tests.txt pass per verifier output (13 greywallProvider + 4 detectSandbox). Deviation: 1-line import-path change in sandbox.greywall.test.ts (../sandbox.greywall → ../sandbox.policy) and 3-line update in sandbox.test.ts to preserve isAvailable via vi.importActual. The 'zero modifications' clause directly conflicts with AC2 (file deletion); minimum modification preserves the behavioral coverage AC6 is protecting. Reasonable interpretation but a flag.
- Criterion 7: src/engine/__tests__/sandbox.parity.test.ts contains 6 tests: 3 for network parity (blocked host, allowed host, deep-equal allowlist) and 3 for filesystem parity (blocked /etc/passwd, allowed buildPath, shared /tmp + home cache paths). All passing per verifier.
- Criterion 8: rules/no-child-process-in-sandbox.yml exists with severity:error; sgconfig.yml ruleDirs includes 'rules'. sandbox.ts no longer imports node:child_process (verified — line 1 imports only from ./sandbox.policy). sandbox.types.ts contains no child_process import (only JSDoc prose mentions). isAvailable was relocated to sandbox.policy.ts:233-240.
