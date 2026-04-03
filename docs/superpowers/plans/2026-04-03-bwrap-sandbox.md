# Bwrap Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in bubblewrap sandboxing to builder and reviewer Claude invocations, restricting filesystem writes to the repo and `/tmp`, and blocking network by default.

**Architecture:** A new `sandbox.ts` module handles bwrap detection and argument building. `claude.exec.ts` conditionally prefixes the spawn command with bwrap args. Config, CLI, and pipeline files thread the two new flags (`sandbox`, `allowNetwork`) through the existing plumbing.

**Tech Stack:** Node.js `child_process`, `execSync` for bwrap detection, vitest for tests.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/engine/claude/sandbox.ts` | Create | bwrap detection + argument building |
| `src/engine/claude/__tests__/sandbox.test.ts` | Create | Tests for sandbox module |
| `src/types.ts` | Modify | Add `sandbox` and `allowNetwork` to `RidgelineConfig` |
| `src/config.ts` | Modify | Resolve sandbox opts from CLI |
| `src/__tests__/config.test.ts` | Modify | Test new config fields |
| `src/cli.ts` | Modify | Add `--sandbox` and `--allow-network` flags |
| `src/engine/claude/claude.exec.ts` | Modify | Wrap spawn with bwrap when sandboxed |
| `src/engine/claude/__tests__/claude.exec.test.ts` | Modify | Test sandbox spawn behavior |
| `src/engine/pipeline/build.exec.ts` | Modify | Pass sandbox opts to invokeClaude |
| `src/engine/pipeline/review.exec.ts` | Modify | Pass sandbox opts to invokeClaude |
| `src/commands/build.ts` | Modify | Call assertBwrapAvailable before phase loop |
| `SECURITY.md` | Modify | Document sandbox feature |
| `README.md` | Modify | Add --sandbox and --allow-network to build flags table |

---

### Task 1: Create the sandbox module

**Files:**
- Create: `src/engine/claude/sandbox.ts`
- Test: `src/engine/claude/__tests__/sandbox.test.ts`

- [ ] **Step 1: Write the failing tests for `buildBwrapArgs`**

```typescript
// src/engine/claude/__tests__/sandbox.test.ts
import { describe, it, expect } from "vitest"
import { buildBwrapArgs } from "../sandbox"

describe("sandbox", () => {
  describe("buildBwrapArgs", () => {
    it("returns args with network blocked by default", () => {
      const args = buildBwrapArgs("/home/user/project", false)

      expect(args).toContain("--ro-bind")
      expect(args).toContain("--bind")
      expect(args).toContain("--unshare-net")
      expect(args).toContain("--die-with-parent")

      // Repo root is writable
      const bindIdx = args.indexOf("--bind")
      expect(args[bindIdx + 1]).toBe("/home/user/project")
      expect(args[bindIdx + 2]).toBe("/home/user/project")
    })

    it("omits --unshare-net when allowNetwork is true", () => {
      const args = buildBwrapArgs("/home/user/project", true)

      expect(args).not.toContain("--unshare-net")
    })

    it("mounts /tmp as writable", () => {
      const args = buildBwrapArgs("/repo", false)

      // Find the second --bind (first is repo, second is /tmp)
      const bindIndices = args.reduce<number[]>((acc, val, idx) => {
        if (val === "--bind") acc.push(idx)
        return acc
      }, [])

      const tmpBind = bindIndices.find((idx) => args[idx + 1] === "/tmp")
      expect(tmpBind).toBeDefined()
      expect(args[tmpBind! + 2]).toBe("/tmp")
    })

    it("mounts / as read-only", () => {
      const args = buildBwrapArgs("/repo", false)

      const roIdx = args.indexOf("--ro-bind")
      expect(args[roIdx + 1]).toBe("/")
      expect(args[roIdx + 2]).toBe("/")
    })

    it("includes --dev /dev and --proc /proc", () => {
      const args = buildBwrapArgs("/repo", false)

      const devIdx = args.indexOf("--dev")
      expect(args[devIdx + 1]).toBe("/dev")

      const procIdx = args.indexOf("--proc")
      expect(args[procIdx + 1]).toBe("/proc")
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/claude/__tests__/sandbox.test.ts`
Expected: FAIL — module `../sandbox` does not exist.

- [ ] **Step 3: Implement `buildBwrapArgs`**

```typescript
// src/engine/claude/sandbox.ts
import { execSync } from "node:child_process"

export const buildBwrapArgs = (repoRoot: string, allowNetwork: boolean): string[] => {
  const args: string[] = [
    "--ro-bind", "/", "/",
    "--bind", repoRoot, repoRoot,
    "--bind", "/tmp", "/tmp",
    "--dev", "/dev",
    "--proc", "/proc",
    "--die-with-parent",
  ]

  if (!allowNetwork) {
    args.push("--unshare-net")
  }

  return args
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/claude/__tests__/sandbox.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Add tests for `assertBwrapAvailable`**

Append to the test file:

```typescript
import { assertBwrapAvailable } from "../sandbox"
import { execSync } from "node:child_process"
import { vi, beforeEach } from "vitest"

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}))

// Add this describe block inside the top-level describe("sandbox", ...)
describe("assertBwrapAvailable", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("does not throw when bwrap is found", () => {
    vi.mocked(execSync).mockReturnValue("/usr/bin/bwrap")
    expect(() => assertBwrapAvailable()).not.toThrow()
  })

  it("throws with install hint when bwrap is not found", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("not found")
    })
    expect(() => assertBwrapAvailable()).toThrow("--sandbox requires bubblewrap")
    expect(() => assertBwrapAvailable()).toThrow("apt install bubblewrap")
  })
})
```

Note: since this `describe` block mocks `child_process`, it must be placed in a **separate test file** or the `buildBwrapArgs` tests need to be restructured. The cleaner approach: split into two test files, or use `vi.mock` at the top and import `buildBwrapArgs` (which doesn't use `execSync` at the module level). Since `buildBwrapArgs` doesn't call `execSync`, mocking `child_process` at the file level is fine — `buildBwrapArgs` will still work. Structure the test file as:

```typescript
// src/engine/claude/__tests__/sandbox.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}))

import { execSync } from "node:child_process"
import { buildBwrapArgs, assertBwrapAvailable } from "../sandbox"

describe("sandbox", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe("buildBwrapArgs", () => {
    // ... all 5 tests from Step 1 ...
  })

  describe("assertBwrapAvailable", () => {
    it("does not throw when bwrap is found", () => {
      vi.mocked(execSync).mockReturnValue("/usr/bin/bwrap")
      expect(() => assertBwrapAvailable()).not.toThrow()
    })

    it("throws with install hint when bwrap is not found", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found")
      })
      expect(() => assertBwrapAvailable()).toThrow("--sandbox requires bubblewrap")
      expect(() => assertBwrapAvailable()).toThrow("apt install bubblewrap")
    })
  })
})
```

- [ ] **Step 6: Implement `assertBwrapAvailable`**

Add to `src/engine/claude/sandbox.ts`:

```typescript
export const assertBwrapAvailable = (): void => {
  try {
    execSync("which bwrap", { stdio: ["pipe", "pipe", "pipe"] })
  } catch {
    throw new Error(
      "--sandbox requires bubblewrap (bwrap). Install it with your package manager " +
      "(e.g., apt install bubblewrap)."
    )
  }
}
```

- [ ] **Step 7: Run all sandbox tests**

Run: `npx vitest run src/engine/claude/__tests__/sandbox.test.ts`
Expected: All 7 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/engine/claude/sandbox.ts src/engine/claude/__tests__/sandbox.test.ts
git commit -m "feat: add sandbox module for bwrap detection and arg building"
```

---

### Task 2: Add sandbox fields to config

**Files:**
- Modify: `src/types.ts:1-16`
- Modify: `src/config.ts:50-64`
- Modify: `src/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests inside the existing `describe("resolveConfig", ...)` block in `src/__tests__/config.test.ts`:

```typescript
it("defaults sandbox and allowNetwork to false", () => {
  mockResolveFile.mockImplementation((_flag, _buildDir, filename) => {
    if (filename === "constraints.md") return "/fake/constraints.md"
    return null
  })
  mockParseCheckCommand.mockReturnValue(null)

  const config = resolveConfig("test", {})

  expect(config.sandbox).toBe(false)
  expect(config.allowNetwork).toBe(false)
})

it("sets sandbox and allowNetwork from CLI opts", () => {
  mockResolveFile.mockImplementation((_flag, _buildDir, filename) => {
    if (filename === "constraints.md") return "/fake/constraints.md"
    return null
  })
  mockParseCheckCommand.mockReturnValue(null)

  const config = resolveConfig("test", { sandbox: true, allowNetwork: true })

  expect(config.sandbox).toBe(true)
  expect(config.allowNetwork).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/config.test.ts`
Expected: FAIL — `sandbox` and `allowNetwork` not on config.

- [ ] **Step 3: Add fields to `RidgelineConfig`**

In `src/types.ts`, add two fields at the end of the `RidgelineConfig` type (after `maxBudgetUsd`):

```typescript
  sandbox: boolean
  allowNetwork: boolean
```

- [ ] **Step 4: Resolve new fields in `config.ts`**

In `src/config.ts`, add to the return object inside `resolveConfig` (after the `maxBudgetUsd` line):

```typescript
    sandbox: opts.sandbox === true,
    allowNetwork: opts.allowNetwork === true,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/config.test.ts`
Expected: All tests PASS (including existing ones).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/config.ts src/__tests__/config.test.ts
git commit -m "feat: add sandbox and allowNetwork to RidgelineConfig"
```

---

### Task 3: Add CLI flags

**Files:**
- Modify: `src/cli.ts:77-97`

- [ ] **Step 1: Add `--sandbox` and `--allow-network` options to the `build` command**

In `src/cli.ts`, add two `.option()` calls to the `build` command chain, after the `--taste` option (line 87) and before the `.action()`:

```typescript
  .option("--sandbox", "Enable bwrap sandboxing (Linux only)")
  .option("--allow-network", "Permit network access inside sandbox")
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: Compiles without errors.

- [ ] **Step 3: Verify CLI help shows new flags**

Run: `node dist/cli.js build --help`
Expected: Output includes `--sandbox` and `--allow-network` in the options list.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add --sandbox and --allow-network CLI flags to build command"
```

---

### Task 4: Wire sandbox into `claude.exec.ts`

**Files:**
- Modify: `src/engine/claude/claude.exec.ts:5-17,19-56`
- Modify: `src/engine/claude/__tests__/claude.exec.test.ts`

- [ ] **Step 1: Write the failing test for sandbox spawn**

Add this test inside the existing `describe("invokeClaude", ...)` block in `src/engine/claude/__tests__/claude.exec.test.ts`:

```typescript
it("spawns bwrap wrapping claude when sandbox is enabled", () => {
  const promise = invokeClaude({ ...baseOpts, sandbox: true, allowNetwork: false })

  expect(spawn).toHaveBeenCalledWith(
    "bwrap",
    expect.arrayContaining(["--ro-bind", "/", "/", "--unshare-net", "--die-with-parent", "claude"]),
    expect.objectContaining({ cwd: "/tmp" })
  )

  const proc = vi.mocked(spawn).mock.results[0].value
  proc.stdout.emit("data", Buffer.from(sampleResultLine + "\n"))
  proc.emit("close", 0)

  return promise
})

it("spawns bwrap without --unshare-net when allowNetwork is true", () => {
  const promise = invokeClaude({ ...baseOpts, sandbox: true, allowNetwork: true })

  const calledArgs = vi.mocked(spawn).mock.calls[0][1] as string[]
  expect(calledArgs).not.toContain("--unshare-net")
  expect(calledArgs).toContain("--ro-bind")
  expect(calledArgs).toContain("claude")

  const proc = vi.mocked(spawn).mock.results[0].value
  proc.stdout.emit("data", Buffer.from(sampleResultLine + "\n"))
  proc.emit("close", 0)

  return promise
})

it("spawns claude directly when sandbox is not enabled", () => {
  const promise = invokeClaude({ ...baseOpts, sandbox: false })

  expect(spawn).toHaveBeenCalledWith(
    "claude",
    expect.any(Array),
    expect.any(Object)
  )

  const proc = vi.mocked(spawn).mock.results[0].value
  proc.stdout.emit("data", Buffer.from(sampleResultLine + "\n"))
  proc.emit("close", 0)

  return promise
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/claude/__tests__/claude.exec.test.ts`
Expected: FAIL — `sandbox` is not recognized on `InvokeOptions`.

- [ ] **Step 3: Add sandbox fields to `InvokeOptions`**

In `src/engine/claude/claude.exec.ts`, add to the `InvokeOptions` type (after `onStdout`):

```typescript
  sandbox?: boolean
  allowNetwork?: boolean
```

- [ ] **Step 4: Modify the spawn call to use bwrap when sandboxed**

In `src/engine/claude/claude.exec.ts`, add the import at the top:

```typescript
import { buildBwrapArgs } from "./sandbox"
```

Replace the spawn call (around line 53):

```typescript
    // Current:
    const proc: ChildProcess = spawn("claude", args, {
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    })
```

with:

```typescript
    const spawnCmd = opts.sandbox ? "bwrap" : "claude"
    const spawnArgs = opts.sandbox
      ? [...buildBwrapArgs(opts.cwd, opts.allowNetwork ?? false), "claude", ...args]
      : args

    const proc: ChildProcess = spawn(spawnCmd, spawnArgs, {
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    })
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/engine/claude/__tests__/claude.exec.test.ts`
Expected: All tests PASS (existing + 3 new).

- [ ] **Step 6: Commit**

```bash
git add src/engine/claude/claude.exec.ts src/engine/claude/__tests__/claude.exec.test.ts
git commit -m "feat: wrap claude spawn with bwrap when sandbox is enabled"
```

---

### Task 5: Thread sandbox opts through the pipeline

**Files:**
- Modify: `src/engine/pipeline/build.exec.ts:78-88`
- Modify: `src/engine/pipeline/review.exec.ts:54-64`
- Modify: `src/commands/build.ts:77-110`

- [ ] **Step 1: Pass sandbox opts in `invokeBuilder`**

In `src/engine/pipeline/build.exec.ts`, add `sandbox` and `allowNetwork` to the `invokeClaude` call (inside the options object, after `onStdout`):

```typescript
      sandbox: config.sandbox,
      allowNetwork: config.allowNetwork,
```

- [ ] **Step 2: Pass sandbox opts in `invokeReviewer`**

In `src/engine/pipeline/review.exec.ts`, add the same two fields to the `invokeClaude` call (inside the options object, after `onStdout`):

```typescript
      sandbox: config.sandbox,
      allowNetwork: config.allowNetwork,
```

- [ ] **Step 3: Add bwrap availability check in `runBuild`**

In `src/commands/build.ts`, add the import at the top:

```typescript
import { assertBwrapAvailable } from "../engine/claude/sandbox"
```

Add the availability check after the state init block (after line 104, before `const startTime`), right before the phase loop starts:

```typescript
  // Validate sandbox availability before starting phases
  if (config.sandbox) {
    assertBwrapAvailable()
    printInfo(`Sandbox: bwrap (network: ${config.allowNetwork ? "allowed" : "blocked"})`)
  }
```

- [ ] **Step 4: Include sandbox status in trajectory entries**

In `src/engine/pipeline/phase.sequence.ts`, update the `build_start` trajectory call (line 40) to include sandbox info in the summary:

Change:
```typescript
    logTrajectory(config.buildDir, makeTrajectoryEntry("build_start", phase.id, `Build attempt ${attempt + 1}`))
```

to:
```typescript
    const sandboxNote = config.sandbox ? ` [sandbox: network=${config.allowNetwork ? "allowed" : "blocked"}]` : ""
    logTrajectory(config.buildDir, makeTrajectoryEntry("build_start", phase.id, `Build attempt ${attempt + 1}${sandboxNote}`))
```

Similarly, update the `review_start` trajectory call (line 77):

Change:
```typescript
    logTrajectory(config.buildDir, makeTrajectoryEntry("review_start", phase.id, `Review attempt ${attempt + 1}`))
```

to:
```typescript
    logTrajectory(config.buildDir, makeTrajectoryEntry("review_start", phase.id, `Review attempt ${attempt + 1}${sandboxNote}`))
```

Note: the `sandboxNote` variable is already in scope from the build section above since both are inside the same `while` loop body.

- [ ] **Step 5: Verify the build compiles**

Run: `npm run build`
Expected: Compiles without errors.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: All tests PASS (typecheck + lint + unit tests).

- [ ] **Step 7: Commit**

```bash
git add src/engine/pipeline/build.exec.ts src/engine/pipeline/review.exec.ts src/commands/build.ts src/engine/pipeline/phase.sequence.ts
git commit -m "feat: thread sandbox config through build pipeline"
```

---

### Task 6: Update docs

**Files:**
- Modify: `README.md`
- Modify: `SECURITY.md`

- [ ] **Step 1: Add sandbox flags to README build command table**

In `README.md`, add two rows to the `build` command flags table (after `--taste`):

```markdown
| `--sandbox` | off | Enable bwrap sandboxing (Linux only) |
| `--allow-network` | off | Permit network access inside sandbox |
```

- [ ] **Step 2: Add sandbox section to SECURITY.md**

In `SECURITY.md`, add a new section after "## Retry limits" and before "## Verdict parsing":

```markdown
## Sandbox mode (Linux)

When `--sandbox` is passed to `ridgeline build`, each Claude CLI invocation
(builder and reviewer) runs inside a [bubblewrap](https://github.com/containers/bubblewrap)
sandbox. This enforces kernel-level restrictions:

- **Filesystem:** The entire filesystem is mounted read-only. Only the
  repository root and `/tmp` are writable. Writes anywhere else fail with
  `EROFS`.
- **Network:** Outbound network access is blocked by default via Linux network
  namespaces. Pass `--allow-network` to permit it for builds that need
  dependency installation or API access.
- **Process isolation:** `--die-with-parent` ensures the sandbox is torn down
  if Ridgeline exits unexpectedly.

Sandboxing requires `bwrap` to be installed. If it is not found, the harness
errors immediately — there is no silent fallback. This feature is Linux-only;
macOS lacks equivalent unprivileged namespace support.
```

Also update the "What we chose not to implement" > "Container isolation" section to mention that bwrap sandboxing is now available as a lighter alternative:

Replace the first paragraph of the "Container isolation" subsection with:

```markdown
The builder agent has access to `Bash`, `Write`, and `Edit` — it can execute
arbitrary commands and modify any file in the repository. Full container
isolation (Docker/VM) would sandbox the filesystem and network completely, but
adds substantial setup complexity. Instead, Ridgeline offers opt-in `--sandbox`
mode using bubblewrap (`bwrap`) on Linux, which provides kernel-level
filesystem and network restrictions without containerization overhead. See
[Sandbox mode](#sandbox-mode-linux) above.
```

- [ ] **Step 3: Run markdown lint**

Run: `npm run lint:markdown`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add README.md SECURITY.md
git commit -m "docs: document --sandbox and --allow-network in README and SECURITY.md"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: All typecheck, lint, and unit tests PASS.

- [ ] **Step 2: Verify build output**

Run: `npm run build`
Expected: Compiles cleanly. `dist/engine/claude/sandbox.js` exists.

- [ ] **Step 3: Verify CLI end-to-end**

Run: `node dist/cli.js build --help`
Expected: Output includes `--sandbox` and `--allow-network`.

Run: `node dist/cli.js build fake-build --sandbox 2>&1 || true`
Expected: Errors with either "bwrap not found" (macOS/Linux without bwrap) or "constraints.md not found" (no build dir). Confirms the flag is wired through.
