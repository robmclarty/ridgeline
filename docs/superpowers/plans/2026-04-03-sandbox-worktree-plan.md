# Sandbox, Worktree, and Network Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace opt-in bwrap sandboxing with auto-detected sandbox-by-default (Greywall on macOS, bwrap on Linux), add worktree-per-build isolation, and a fallback network guard hook.

**Architecture:** Three independent features layered on the existing pipeline. The sandbox abstraction replaces the current bwrap-specific code with a provider interface auto-detected at build start. Worktree isolation wraps each build in a git worktree, reflecting completed phases back to the user's branch. The network guard hook is a PreToolUse hook loaded only in `--unsafe` mode.

**Tech Stack:** TypeScript, vitest, Claude CLI flags, git worktrees, Greywall CLI, bubblewrap (bwrap)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/engine/claude/sandbox.bwrap.ts` | Bwrap sandbox provider (extracted from current sandbox.ts) |
| `src/engine/claude/sandbox.greywall.ts` | Greywall sandbox provider |
| `src/store/settings.ts` | Load and parse `.ridgeline/settings.json` |
| `src/engine/worktree.ts` | Worktree lifecycle (create, validate, reflect, cleanup) |
| `src/commands/clean.ts` | `ridgeline clean` command implementation |
| `src/agents/core/hooks/network-guard.md` | PreToolUse hook for unsafe mode |
| `src/engine/claude/__tests__/sandbox.bwrap.test.ts` | Tests for bwrap provider |
| `src/engine/claude/__tests__/sandbox.greywall.test.ts` | Tests for greywall provider |
| `src/store/__tests__/settings.test.ts` | Tests for settings loader |
| `src/engine/__tests__/worktree.test.ts` | Tests for worktree lifecycle |
| `src/commands/__tests__/clean.test.ts` | Tests for clean command |

### Modified Files

| File | Change |
|------|--------|
| `src/engine/claude/sandbox.ts` | Replace bwrap-specific code with provider interface + auto-detection |
| `src/engine/claude/__tests__/sandbox.test.ts` | Rewrite for new provider interface + auto-detection |
| `src/types.ts` | Replace `sandbox`/`allowNetwork` with `unsafe`/`networkAllowlist` on RidgelineConfig |
| `src/config.ts` | Load settings.json, resolve `unsafe` and `networkAllowlist` |
| `src/__tests__/config.test.ts` | Update for new config fields |
| `src/engine/claude/claude.exec.ts` | Use sandbox provider instead of bwrap branch |
| `src/engine/claude/__tests__/claude.exec.test.ts` | Update for new InvokeOptions |
| `src/engine/pipeline/build.exec.ts` | Accept and pass worktree cwd and sandbox provider |
| `src/engine/pipeline/review.exec.ts` | Accept and pass worktree cwd and sandbox provider |
| `src/engine/pipeline/phase.sequence.ts` | Pass worktree cwd through to builder/reviewer |
| `src/commands/build.ts` | Sandbox detection, worktree setup/teardown, reflect commits |
| `src/commands/__tests__/build.test.ts` | Update for new config shape and worktree flow |
| `src/cli.ts` | Replace `--sandbox`/`--allow-network` with `--unsafe`, add `clean` command |
| `src/engine/discovery/plugin.scan.ts` | Conditionally include network-guard hook plugin dir |

---

## Task 1: Sandbox Provider Interface and Bwrap Extraction

**Files:**
- Create: `src/engine/claude/sandbox.bwrap.ts`
- Create: `src/engine/claude/__tests__/sandbox.bwrap.test.ts`
- Modify: `src/engine/claude/sandbox.ts`
- Modify: `src/engine/claude/__tests__/sandbox.test.ts`

- [ ] **Step 1: Write the SandboxProvider type and bwrap provider test**

Create `src/engine/claude/__tests__/sandbox.bwrap.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { bwrapProvider } from "../sandbox.bwrap"

describe("bwrapProvider", () => {
  it("has name 'bwrap' and command 'bwrap'", () => {
    expect(bwrapProvider.name).toBe("bwrap")
    expect(bwrapProvider.command).toBe("bwrap")
  })

  it("returns args with network blocked and repo writable", () => {
    const args = bwrapProvider.buildArgs("/home/user/project", ["registry.npmjs.org"])

    expect(args).toContain("--ro-bind")
    expect(args).toContain("--unshare-net")
    expect(args).toContain("--die-with-parent")

    const bindIdx = args.indexOf("--bind")
    expect(args[bindIdx + 1]).toBe("/home/user/project")
    expect(args[bindIdx + 2]).toBe("/home/user/project")
  })

  it("ignores the network allowlist (bwrap has no domain filtering)", () => {
    const args = bwrapProvider.buildArgs("/repo", ["registry.npmjs.org", "github.com"])
    expect(args).toContain("--unshare-net")
    expect(args.join(" ")).not.toContain("registry.npmjs.org")
  })

  it("mounts /tmp as writable", () => {
    const args = bwrapProvider.buildArgs("/repo", [])
    const bindIndices = args.reduce<number[]>((acc, val, idx) => {
      if (val === "--bind") acc.push(idx)
      return acc
    }, [])
    const tmpBind = bindIndices.find((idx) => args[idx + 1] === "/tmp")
    expect(tmpBind).toBeDefined()
  })

  it("mounts / as read-only", () => {
    const args = bwrapProvider.buildArgs("/repo", [])
    const roIdx = args.indexOf("--ro-bind")
    expect(args[roIdx + 1]).toBe("/")
    expect(args[roIdx + 2]).toBe("/")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/claude/__tests__/sandbox.bwrap.test.ts`
Expected: FAIL — module `../sandbox.bwrap` does not exist

- [ ] **Step 3: Create the SandboxProvider type and bwrap provider**

Create `src/engine/claude/sandbox.bwrap.ts`:

```typescript
import { SandboxProvider } from "./sandbox"

export const bwrapProvider: SandboxProvider = {
  name: "bwrap",
  command: "bwrap",
  buildArgs(repoRoot: string, _networkAllowlist: string[]): string[] {
    return [
      "--ro-bind", "/", "/",
      "--bind", repoRoot, repoRoot,
      "--bind", "/tmp", "/tmp",
      "--dev", "/dev",
      "--proc", "/proc",
      "--die-with-parent",
      "--unshare-net",
    ]
  },
}
```

Rewrite `src/engine/claude/sandbox.ts` to export the provider type and detection logic:

```typescript
import { execSync } from "node:child_process"

export type SandboxProvider = {
  name: "bwrap" | "greywall"
  command: string
  buildArgs: (repoRoot: string, networkAllowlist: string[]) => string[]
}

const isAvailable = (cmd: string): boolean => {
  try {
    execSync(`which ${cmd}`, { stdio: ["pipe", "pipe", "pipe"] })
    return true
  } catch {
    return false
  }
}

export const detectSandbox = (): SandboxProvider | null => {
  // Prefer greywall (cross-platform, supports domain allowlisting)
  if (isAvailable("greywall")) {
    const { greywallProvider } = require("./sandbox.greywall")
    return greywallProvider
  }

  // Fall back to bwrap (Linux only, binary network toggle)
  if (process.platform === "linux" && isAvailable("bwrap")) {
    const { bwrapProvider } = require("./sandbox.bwrap")
    return bwrapProvider
  }

  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/claude/__tests__/sandbox.bwrap.test.ts`
Expected: PASS

- [ ] **Step 5: Rewrite sandbox.test.ts for the new interface**

Replace `src/engine/claude/__tests__/sandbox.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}))

// Mock the provider modules so detectSandbox can require them
vi.mock("../sandbox.bwrap", () => ({
  bwrapProvider: { name: "bwrap", command: "bwrap", buildArgs: vi.fn(() => []) },
}))

vi.mock("../sandbox.greywall", () => ({
  greywallProvider: { name: "greywall", command: "greywall", buildArgs: vi.fn(() => []) },
}))

import { execSync } from "node:child_process"
import { detectSandbox } from "../sandbox"

describe("detectSandbox", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("returns greywall provider when greywall is available", () => {
    vi.mocked(execSync).mockReturnValue("/usr/local/bin/greywall")

    const provider = detectSandbox()
    expect(provider).not.toBeNull()
    expect(provider!.name).toBe("greywall")
  })

  it("returns bwrap provider on linux when greywall is absent", () => {
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (String(cmd).includes("greywall")) throw new Error("not found")
      return "/usr/bin/bwrap"
    })

    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform")
    Object.defineProperty(process, "platform", { value: "linux" })

    const provider = detectSandbox()
    expect(provider).not.toBeNull()
    expect(provider!.name).toBe("bwrap")

    if (origPlatform) Object.defineProperty(process, "platform", origPlatform)
  })

  it("returns null on macOS when greywall is absent", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("not found")
    })

    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform")
    Object.defineProperty(process, "platform", { value: "darwin" })

    const provider = detectSandbox()
    expect(provider).toBeNull()

    if (origPlatform) Object.defineProperty(process, "platform", origPlatform)
  })

  it("returns null when neither tool is available", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("not found")
    })

    const provider = detectSandbox()
    expect(provider).toBeNull()
  })
})
```

- [ ] **Step 6: Run both test files to verify**

Run: `npx vitest run src/engine/claude/__tests__/sandbox.bwrap.test.ts src/engine/claude/__tests__/sandbox.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/engine/claude/sandbox.ts src/engine/claude/sandbox.bwrap.ts src/engine/claude/__tests__/sandbox.test.ts src/engine/claude/__tests__/sandbox.bwrap.test.ts
git commit -m "refactor: extract sandbox provider interface and bwrap provider"
```

---

## Task 2: Greywall Provider

**Files:**
- Create: `src/engine/claude/sandbox.greywall.ts`
- Create: `src/engine/claude/__tests__/sandbox.greywall.test.ts`

- [ ] **Step 1: Write the greywall provider test**

Create `src/engine/claude/__tests__/sandbox.greywall.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { greywallProvider } from "../sandbox.greywall"

describe("greywallProvider", () => {
  it("has name 'greywall' and command 'greywall'", () => {
    expect(greywallProvider.name).toBe("greywall")
    expect(greywallProvider.command).toBe("greywall")
  })

  it("allows the repo directory and /tmp", () => {
    const args = greywallProvider.buildArgs("/my/repo", [])

    expect(args).toContain("--allow-dir")
    const dirIndices = args.reduce<number[]>((acc, val, idx) => {
      if (val === "--allow-dir") acc.push(idx)
      return acc
    }, [])
    const dirs = dirIndices.map((i) => args[i + 1])
    expect(dirs).toContain("/my/repo")
    expect(dirs).toContain("/tmp")
  })

  it("passes each domain in the allowlist as --allow-network", () => {
    const args = greywallProvider.buildArgs("/repo", [
      "registry.npmjs.org",
      "github.com",
    ])

    const netIndices = args.reduce<number[]>((acc, val, idx) => {
      if (val === "--allow-network") acc.push(idx)
      return acc
    }, [])
    const domains = netIndices.map((i) => args[i + 1])
    expect(domains).toContain("registry.npmjs.org")
    expect(domains).toContain("github.com")
  })

  it("ends with -- separator", () => {
    const args = greywallProvider.buildArgs("/repo", [])
    expect(args[args.length - 1]).toBe("--")
  })

  it("produces no --allow-network flags when allowlist is empty", () => {
    const args = greywallProvider.buildArgs("/repo", [])
    expect(args).not.toContain("--allow-network")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/claude/__tests__/sandbox.greywall.test.ts`
Expected: FAIL — module `../sandbox.greywall` does not exist

- [ ] **Step 3: Implement the greywall provider**

Create `src/engine/claude/sandbox.greywall.ts`:

```typescript
import { SandboxProvider } from "./sandbox"

export const greywallProvider: SandboxProvider = {
  name: "greywall",
  command: "greywall",
  buildArgs(repoRoot: string, networkAllowlist: string[]): string[] {
    const args: string[] = [
      "--allow-dir", repoRoot,
      "--allow-dir", "/tmp",
    ]
    for (const domain of networkAllowlist) {
      args.push("--allow-network", domain)
    }
    args.push("--")
    return args
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/claude/__tests__/sandbox.greywall.test.ts`
Expected: PASS

- [ ] **Step 5: Run all sandbox tests together**

Run: `npx vitest run src/engine/claude/__tests__/sandbox.bwrap.test.ts src/engine/claude/__tests__/sandbox.greywall.test.ts src/engine/claude/__tests__/sandbox.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/engine/claude/sandbox.greywall.ts src/engine/claude/__tests__/sandbox.greywall.test.ts
git commit -m "feat: add greywall sandbox provider for macOS/Linux"
```

---

## Task 3: Settings Loader and Network Allowlist

**Files:**
- Create: `src/store/settings.ts`
- Create: `src/store/__tests__/settings.test.ts`

- [ ] **Step 1: Write settings loader tests**

Create `src/store/__tests__/settings.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"
import { loadSettings, resolveNetworkAllowlist, DEFAULT_NETWORK_ALLOWLIST } from "../settings"

describe("settings", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTempDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe("loadSettings", () => {
    it("returns empty object when settings.json does not exist", () => {
      const settings = loadSettings(tmpDir)
      expect(settings).toEqual({})
    })

    it("loads and parses settings.json", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ network: { allowlist: ["example.com"] } })
      )
      const settings = loadSettings(tmpDir)
      expect(settings.network?.allowlist).toEqual(["example.com"])
    })

    it("returns empty object on invalid JSON", () => {
      fs.writeFileSync(path.join(tmpDir, "settings.json"), "not json")
      const settings = loadSettings(tmpDir)
      expect(settings).toEqual({})
    })
  })

  describe("resolveNetworkAllowlist", () => {
    it("returns defaults when no settings file exists", () => {
      const allowlist = resolveNetworkAllowlist(tmpDir)
      expect(allowlist).toEqual(DEFAULT_NETWORK_ALLOWLIST)
    })

    it("replaces defaults when user specifies allowlist", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ network: { allowlist: ["custom.registry.com"] } })
      )
      const allowlist = resolveNetworkAllowlist(tmpDir)
      expect(allowlist).toEqual(["custom.registry.com"])
    })

    it("returns defaults when network key is present but allowlist is omitted", () => {
      fs.writeFileSync(
        path.join(tmpDir, "settings.json"),
        JSON.stringify({ network: {} })
      )
      const allowlist = resolveNetworkAllowlist(tmpDir)
      expect(allowlist).toEqual(DEFAULT_NETWORK_ALLOWLIST)
    })
  })

  describe("DEFAULT_NETWORK_ALLOWLIST", () => {
    it("contains common package registries", () => {
      expect(DEFAULT_NETWORK_ALLOWLIST).toContain("registry.npmjs.org")
      expect(DEFAULT_NETWORK_ALLOWLIST).toContain("pypi.org")
      expect(DEFAULT_NETWORK_ALLOWLIST).toContain("crates.io")
    })

    it("contains common git hosts", () => {
      expect(DEFAULT_NETWORK_ALLOWLIST).toContain("github.com")
      expect(DEFAULT_NETWORK_ALLOWLIST).toContain("gitlab.com")
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/__tests__/settings.test.ts`
Expected: FAIL — module `../settings` does not exist

- [ ] **Step 3: Implement the settings loader**

Create `src/store/settings.ts`:

```typescript
import * as fs from "node:fs"
import * as path from "node:path"

export const DEFAULT_NETWORK_ALLOWLIST: string[] = [
  "registry.npmjs.org",
  "pypi.org",
  "files.pythonhosted.org",
  "crates.io",
  "static.crates.io",
  "rubygems.org",
  "proxy.golang.org",
  "github.com",
  "gitlab.com",
  "bitbucket.org",
]

export type RidgelineSettings = {
  network?: {
    allowlist?: string[]
  }
}

export const loadSettings = (ridgelineDir: string): RidgelineSettings => {
  const settingsPath = path.join(ridgelineDir, "settings.json")
  try {
    const raw = fs.readFileSync(settingsPath, "utf-8")
    return JSON.parse(raw) as RidgelineSettings
  } catch {
    return {}
  }
}

export const resolveNetworkAllowlist = (ridgelineDir: string): string[] => {
  const settings = loadSettings(ridgelineDir)
  if (settings.network?.allowlist && settings.network.allowlist.length > 0) {
    return settings.network.allowlist
  }
  return [...DEFAULT_NETWORK_ALLOWLIST]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/__tests__/settings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/settings.ts src/store/__tests__/settings.test.ts
git commit -m "feat: add settings loader with network allowlist defaults"
```

---

## Task 4: Update RidgelineConfig and Config Resolution

**Files:**
- Modify: `src/types.ts:1-18`
- Modify: `src/config.ts:1-67`
- Modify: `src/__tests__/config.test.ts`

- [ ] **Step 1: Update the RidgelineConfig type**

In `src/types.ts`, replace the `sandbox` and `allowNetwork` fields:

```typescript
// Replace lines 16-17:
//   sandbox: boolean
//   allowNetwork: boolean
// With:
  unsafe: boolean
  networkAllowlist: string[]
  sandboxProvider?: import("./engine/claude/sandbox").SandboxProvider | null
  worktreePath: string | null
```

- [ ] **Step 2: Update resolveConfig to use new fields**

In `src/config.ts`, add the settings import and update the config resolution.

Add import at top:

```typescript
import { resolveNetworkAllowlist } from "./store/settings"
```

Replace lines 64-65 in the return object:

```typescript
// Replace:
//     sandbox: opts.sandbox === true,
//     allowNetwork: opts.allowNetwork === true,
// With:
    unsafe: opts.unsafe === true,
    networkAllowlist: resolveNetworkAllowlist(ridgelineDir),
    worktreePath: null,
```

- [ ] **Step 3: Update config tests**

In `src/__tests__/config.test.ts`, add the settings mock and update tests.

Add mock before imports:

```typescript
vi.mock("../store/settings", () => ({
  resolveNetworkAllowlist: vi.fn(() => ["registry.npmjs.org"]),
}))
```

Replace the test at lines 117-128 ("defaults sandbox and allowNetwork to false"):

```typescript
    it("defaults unsafe to false", () => {
      mockResolveFile.mockImplementation((_flag, _buildDir, filename) => {
        if (filename === "constraints.md") return "/fake/constraints.md"
        return null
      })
      mockParseCheckCommand.mockReturnValue(null)

      const config = resolveConfig("test", {})

      expect(config.unsafe).toBe(false)
      expect(config.networkAllowlist).toEqual(["registry.npmjs.org"])
    })
```

Replace the test at lines 130-141 ("sets sandbox and allowNetwork from CLI opts"):

```typescript
    it("sets unsafe from CLI opts", () => {
      mockResolveFile.mockImplementation((_flag, _buildDir, filename) => {
        if (filename === "constraints.md") return "/fake/constraints.md"
        return null
      })
      mockParseCheckCommand.mockReturnValue(null)

      const config = resolveConfig("test", { unsafe: true })

      expect(config.unsafe).toBe(true)
    })
```

- [ ] **Step 4: Run config tests**

Run: `npx vitest run src/__tests__/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/config.ts src/__tests__/config.test.ts
git commit -m "refactor: replace sandbox/allowNetwork with unsafe/networkAllowlist in config"
```

---

## Task 5: Update claude.exec.ts to Use Sandbox Provider

**Files:**
- Modify: `src/engine/claude/claude.exec.ts:1-115`
- Modify: `src/engine/claude/__tests__/claude.exec.test.ts`

- [ ] **Step 1: Update InvokeOptions and invokeClaude**

In `src/engine/claude/claude.exec.ts`:

Replace the import at line 4:

```typescript
// Replace:
// import { buildBwrapArgs } from "./sandbox"
// With:
import { SandboxProvider } from "./sandbox"
```

Replace lines 18-19 of InvokeOptions:

```typescript
// Replace:
//   sandbox?: boolean
//   allowNetwork?: boolean
// With:
  sandboxProvider?: SandboxProvider | null
  networkAllowlist?: string[]
```

Replace lines 56-59 (the spawn command logic):

```typescript
// Replace:
//     const spawnCmd = opts.sandbox ? "bwrap" : "claude"
//     const spawnArgs = opts.sandbox
//       ? [...buildBwrapArgs(opts.cwd, opts.allowNetwork ?? false), "claude", ...args]
//       : args
// With:
    const provider = opts.sandboxProvider ?? null
    const spawnCmd = provider ? provider.command : "claude"
    const spawnArgs = provider
      ? [...provider.buildArgs(opts.cwd, opts.networkAllowlist ?? []), "claude", ...args]
      : args
```

- [ ] **Step 2: Update claude.exec.test.ts**

Replace the sandbox-related tests (lines 188-233) in `src/engine/claude/__tests__/claude.exec.test.ts`.

Replace the `baseOpts` definition (lines 24-29):

```typescript
const baseOpts: InvokeOptions = {
  systemPrompt: "You are a test assistant",
  userPrompt: "Hello",
  model: "opus",
  cwd: "/tmp",
}
```

(This stays the same — no `sandbox` field needed since `sandboxProvider` defaults to undefined.)

Replace lines 188-233 (the three sandbox tests) with:

```typescript
    it("spawns via sandbox provider when one is given", () => {
      const mockProvider = {
        name: "bwrap" as const,
        command: "bwrap",
        buildArgs: vi.fn(() => ["--ro-bind", "/", "/", "--unshare-net", "--die-with-parent"]),
      }

      const promise = invokeClaude({
        ...baseOpts,
        sandboxProvider: mockProvider,
        networkAllowlist: ["registry.npmjs.org"],
      })

      expect(mockProvider.buildArgs).toHaveBeenCalledWith("/tmp", ["registry.npmjs.org"])
      expect(spawn).toHaveBeenCalledWith(
        "bwrap",
        expect.arrayContaining(["--ro-bind", "--unshare-net", "claude"]),
        expect.objectContaining({ cwd: "/tmp" })
      )

      const proc = vi.mocked(spawn).mock.results[0].value
      proc.stdout.emit("data", Buffer.from(sampleResultLine + "\n"))
      proc.emit("close", 0)

      return promise
    })

    it("spawns claude directly when no sandbox provider", () => {
      const promise = invokeClaude({ ...baseOpts, sandboxProvider: null })

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

    it("spawns claude directly when sandboxProvider is undefined", () => {
      const promise = invokeClaude(baseOpts)

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

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/engine/claude/__tests__/claude.exec.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/engine/claude/claude.exec.ts src/engine/claude/__tests__/claude.exec.test.ts
git commit -m "refactor: use sandbox provider interface in claude.exec"
```

---

## Task 6: Update Pipeline Executors to Pass Provider

**Files:**
- Modify: `src/engine/pipeline/build.exec.ts:64-97`
- Modify: `src/engine/pipeline/review.exec.ts:40-74`
- Modify: `src/engine/pipeline/phase.sequence.ts:12-158`
- Modify: `src/commands/build.ts:78-165`

- [ ] **Step 1: Update build.exec.ts**

In `src/engine/pipeline/build.exec.ts`, replace lines 85-89 in the `invokeClaude` call:

```typescript
// Replace:
//       cwd: process.cwd(),
//       timeoutMs: config.timeoutMinutes * 60 * 1000,
//       onStdout,
//       sandbox: config.sandbox,
//       allowNetwork: config.allowNetwork,
// With:
      cwd: config.worktreePath ?? process.cwd(),
      timeoutMs: config.timeoutMinutes * 60 * 1000,
      onStdout,
      sandboxProvider: config.sandboxProvider,
      networkAllowlist: config.networkAllowlist,
```

(`sandboxProvider` and `worktreePath` were already added to `RidgelineConfig` in Task 4.)

- [ ] **Step 2: Update review.exec.ts**

In `src/engine/pipeline/review.exec.ts`, replace lines 62-65:

```typescript
// Replace:
//       cwd: process.cwd(),
//       timeoutMs: config.timeoutMinutes * 60 * 1000,
//       onStdout,
//       sandbox: config.sandbox,
//       allowNetwork: config.allowNetwork,
// With:
      cwd: config.worktreePath ?? process.cwd(),
      timeoutMs: config.timeoutMinutes * 60 * 1000,
      onStdout,
      sandboxProvider: config.sandboxProvider,
      networkAllowlist: config.networkAllowlist,
```

- [ ] **Step 3: Update phase.sequence.ts sandbox note**

In `src/engine/pipeline/phase.sequence.ts`, replace line 30:

```typescript
// Replace:
//   const sandboxNote = config.sandbox ? ` [sandbox: network=${config.allowNetwork ? "allowed" : "blocked"}]` : ""
// With:
  const sandboxNote = config.sandboxProvider ? ` [sandbox: ${config.sandboxProvider.name}]` : ""
```

- [ ] **Step 4: Update commands/build.ts sandbox validation**

In `src/commands/build.ts`, add the sandbox detection import and replace lines 107-111:

Add import at top:

```typescript
import { detectSandbox } from "../engine/claude/sandbox"
```

Remove the `assertBwrapAvailable` import.

Replace lines 107-111:

```typescript
// Replace:
//   if (config.sandbox) {
//     assertBwrapAvailable()
//     printInfo(`Sandbox: bwrap (network: ${config.allowNetwork ? "allowed" : "blocked"})`)
//   }
// With:
  if (!config.unsafe) {
    const provider = detectSandbox()
    config.sandboxProvider = provider
    if (provider) {
      printInfo(`Sandbox: ${provider.name}`)
    } else {
      printInfo("Warning: no sandbox available (install greywall or bwrap)")
    }
  }
```

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (some build.test.ts tests may need config shape updates)

- [ ] **Step 6: Fix any remaining test failures**

Update `src/commands/__tests__/build.test.ts` config object to use `unsafe: false, networkAllowlist: [], worktreePath: null` instead of `sandbox` and `allowNetwork`. Add `ridgelineDir` if missing.

- [ ] **Step 7: Run full test suite again**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/config.ts src/engine/pipeline/build.exec.ts src/engine/pipeline/review.exec.ts src/engine/pipeline/phase.sequence.ts src/commands/build.ts src/commands/__tests__/build.test.ts
git commit -m "feat: wire sandbox provider through pipeline, auto-detect at build start"
```

---

## Task 7: Update CLI Flags

**Files:**
- Modify: `src/cli.ts:77-99`

- [ ] **Step 1: Replace CLI flags**

In `src/cli.ts`, in the `build` command definition (lines 77-99):

Remove these two lines:

```typescript
  .option("--sandbox", "Enable bwrap sandboxing (Linux only)")
  .option("--allow-network", "Permit network access inside sandbox")
```

Add this line in their place:

```typescript
  .option("--unsafe", "Disable sandbox auto-detection")
```

- [ ] **Step 2: Run CLI help to verify**

Run: `npx tsx src/cli.ts build --help`
Expected: Shows `--unsafe` flag, no `--sandbox` or `--allow-network`

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: replace --sandbox/--allow-network with --unsafe flag"
```

---

## Task 8: Worktree Lifecycle Module

**Files:**
- Create: `src/engine/worktree.ts`
- Create: `src/engine/__tests__/worktree.test.ts`

- [ ] **Step 1: Write worktree tests**

Create `src/engine/__tests__/worktree.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { makeTempDir } from "../../../test/setup"
import {
  createWorktree,
  validateWorktree,
  reflectCommits,
  removeWorktree,
  worktreePath,
  wipBranch,
} from "../worktree"

// These tests require a real git repo
const initGitRepo = (dir: string): void => {
  execSync("git init", { cwd: dir, stdio: "pipe" })
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" })
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" })
  fs.writeFileSync(path.join(dir, "README.md"), "# Test")
  execSync("git add -A && git commit -m 'init'", { cwd: dir, stdio: "pipe" })
}

describe("worktree", () => {
  let repoDir: string

  beforeEach(() => {
    repoDir = makeTempDir()
    initGitRepo(repoDir)
  })

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true })
  })

  describe("worktreePath / wipBranch", () => {
    it("returns correct worktree path", () => {
      expect(worktreePath(repoDir, "my-build")).toBe(
        path.join(repoDir, ".ridgeline", "worktrees", "my-build")
      )
    })

    it("returns correct WIP branch name", () => {
      expect(wipBranch("my-build")).toBe("ridgeline/wip/my-build")
    })
  })

  describe("createWorktree", () => {
    it("creates a worktree directory with a WIP branch", () => {
      const wtPath = createWorktree(repoDir, "test-build")

      expect(fs.existsSync(wtPath)).toBe(true)
      expect(fs.existsSync(path.join(wtPath, "README.md"))).toBe(true)

      // Verify branch exists
      const branches = execSync("git branch", { cwd: repoDir, encoding: "utf-8" })
      expect(branches).toContain("ridgeline/wip/test-build")
    })
  })

  describe("validateWorktree", () => {
    it("returns true for a valid worktree", () => {
      createWorktree(repoDir, "test-build")
      expect(validateWorktree(repoDir, "test-build")).toBe(true)
    })

    it("returns false when worktree directory does not exist", () => {
      expect(validateWorktree(repoDir, "nonexistent")).toBe(false)
    })

    it("returns false when worktree is corrupted", () => {
      const wtPath = createWorktree(repoDir, "test-build")
      // Corrupt it by removing .git
      fs.rmSync(path.join(wtPath, ".git"), { force: true })
      expect(validateWorktree(repoDir, "test-build")).toBe(false)
    })
  })

  describe("reflectCommits", () => {
    it("fast-forwards the source branch with worktree commits", () => {
      const wtPath = createWorktree(repoDir, "test-build")

      // Make a commit in the worktree
      fs.writeFileSync(path.join(wtPath, "new-file.ts"), "export const x = 1")
      execSync("git add -A && git commit -m 'add new file'", { cwd: wtPath, stdio: "pipe" })

      // Reflect back
      reflectCommits(repoDir, "test-build")

      // Verify the file appears in the main repo
      const mainBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: repoDir, encoding: "utf-8" }).trim()
      execSync(`git checkout ${mainBranch}`, { cwd: repoDir, stdio: "pipe" })
      expect(fs.existsSync(path.join(repoDir, "new-file.ts"))).toBe(true)
    })
  })

  describe("removeWorktree", () => {
    it("removes the worktree directory and WIP branch", () => {
      const wtPath = createWorktree(repoDir, "test-build")
      expect(fs.existsSync(wtPath)).toBe(true)

      removeWorktree(repoDir, "test-build")

      expect(fs.existsSync(wtPath)).toBe(false)
      const branches = execSync("git branch", { cwd: repoDir, encoding: "utf-8" })
      expect(branches).not.toContain("ridgeline/wip/test-build")
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/__tests__/worktree.test.ts`
Expected: FAIL — module `../worktree` does not exist

- [ ] **Step 3: Implement the worktree module**

Create `src/engine/worktree.ts`:

```typescript
import { execSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

const run = (cmd: string, cwd?: string): string =>
  execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim()

export const worktreePath = (repoRoot: string, buildName: string): string =>
  path.join(repoRoot, ".ridgeline", "worktrees", buildName)

export const wipBranch = (buildName: string): string =>
  `ridgeline/wip/${buildName}`

export const createWorktree = (repoRoot: string, buildName: string): string => {
  const wtPath = worktreePath(repoRoot, buildName)
  const branch = wipBranch(buildName)

  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(wtPath), { recursive: true })

  run(`git worktree add ${wtPath} -b ${branch}`, repoRoot)

  return wtPath
}

export const validateWorktree = (repoRoot: string, buildName: string): boolean => {
  const wtPath = worktreePath(repoRoot, buildName)

  if (!fs.existsSync(wtPath)) return false

  // Check if .git file/dir exists (worktrees have a .git file pointing to main repo)
  const gitPath = path.join(wtPath, ".git")
  if (!fs.existsSync(gitPath)) return false

  // Check if HEAD is valid
  try {
    run("git rev-parse HEAD", wtPath)
    return true
  } catch {
    return false
  }
}

export const reflectCommits = (repoRoot: string, buildName: string): void => {
  const branch = wipBranch(buildName)
  const currentBranch = run("git rev-parse --abbrev-ref HEAD", repoRoot)

  try {
    // Try fast-forward first
    run(`git merge --ff-only ${branch}`, repoRoot)
  } catch {
    // Fall back to regular merge if user's branch diverged
    run(`git merge ${branch} -m "ridgeline: merge ${buildName} phase"`, repoRoot)
  }
}

export const removeWorktree = (repoRoot: string, buildName: string): void => {
  const wtPath = worktreePath(repoRoot, buildName)
  const branch = wipBranch(buildName)

  try {
    run(`git worktree remove ${wtPath} --force`, repoRoot)
  } catch {
    // If worktree remove fails, try manual cleanup
    if (fs.existsSync(wtPath)) {
      fs.rmSync(wtPath, { recursive: true, force: true })
    }
    try {
      run("git worktree prune", repoRoot)
    } catch {
      // best effort
    }
  }

  try {
    run(`git branch -d ${branch}`, repoRoot)
  } catch {
    // Branch may not exist or may not be fully merged
    try {
      run(`git branch -D ${branch}`, repoRoot)
    } catch {
      // best effort
    }
  }
}

export const cleanAllWorktrees = (repoRoot: string): void => {
  const worktreesDir = path.join(repoRoot, ".ridgeline", "worktrees")
  if (!fs.existsSync(worktreesDir)) return

  const entries = fs.readdirSync(worktreesDir)
  for (const entry of entries) {
    const fullPath = path.join(worktreesDir, entry)
    if (fs.statSync(fullPath).isDirectory()) {
      removeWorktree(repoRoot, entry)
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/engine/__tests__/worktree.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/worktree.ts src/engine/__tests__/worktree.test.ts
git commit -m "feat: add worktree lifecycle module"
```

---

## Task 9: Integrate Worktrees into Build Loop

**Files:**
- Modify: `src/commands/build.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Add worktree setup to runBuild**

In `src/commands/build.ts`, add imports:

```typescript
import {
  createWorktree,
  validateWorktree,
  reflectCommits,
  removeWorktree,
  worktreePath as getWorktreePath,
} from "../engine/worktree"
```

After the sandbox detection block (around line 117, after `printInfo("Starting build...")`), add worktree setup:

```typescript
  // Set up worktree
  const repoRoot = process.cwd()
  if (validateWorktree(repoRoot, config.buildName)) {
    config.worktreePath = getWorktreePath(repoRoot, config.buildName)
    printInfo(`Resuming in worktree: ${config.worktreePath}`)
  } else {
    // Clean up broken worktree if it exists
    const existingPath = getWorktreePath(repoRoot, config.buildName)
    if (require("node:fs").existsSync(existingPath)) {
      removeWorktree(repoRoot, config.buildName)
    }
    config.worktreePath = createWorktree(repoRoot, config.buildName)
    printInfo(`Worktree: ${config.worktreePath}`)
  }
```

- [ ] **Step 2: Add commit reflection after each successful phase**

Inside the phase loop, after `completed++` (around line 131):

```typescript
    if (result === "passed") {
      completed++
      reflectCommits(repoRoot, config.buildName)
    }
```

- [ ] **Step 3: Add worktree cleanup on full completion**

At the end of `runBuild`, in the "All phases complete!" block (around line 159-164):

```typescript
  if (totalCompleted === phases.length) {
    console.log("")
    printInfo("All phases complete!")
    printInfo("Cleaning up...")
    cleanupBuildTags(config.buildName)
    removeWorktree(repoRoot, config.buildName)
  }
```

Add `removeWorktree` to the import.

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/build.ts src/types.ts
git commit -m "feat: integrate worktree isolation into build loop"
```

---

## Task 10: Clean Command

**Files:**
- Create: `src/commands/clean.ts`
- Create: `src/commands/__tests__/clean.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write clean command test**

Create `src/commands/__tests__/clean.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { makeTempDir } from "../../../test/setup"

vi.mock("../../ui/output", () => ({
  printInfo: vi.fn(),
}))

import { runClean } from "../clean"

const initGitRepo = (dir: string): void => {
  execSync("git init", { cwd: dir, stdio: "pipe" })
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" })
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" })
  fs.writeFileSync(path.join(dir, "README.md"), "# Test")
  execSync("git add -A && git commit -m 'init'", { cwd: dir, stdio: "pipe" })
}

describe("commands/clean", () => {
  let repoDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    repoDir = makeTempDir()
    initGitRepo(repoDir)
  })

  afterEach(() => {
    // Clean up worktrees before removing the repo
    try {
      execSync("git worktree prune", { cwd: repoDir, stdio: "pipe" })
    } catch {}
    fs.rmSync(repoDir, { recursive: true, force: true })
  })

  it("does nothing when no worktrees directory exists", () => {
    expect(() => runClean(repoDir)).not.toThrow()
  })

  it("removes existing worktrees and WIP branches", () => {
    const worktreesDir = path.join(repoDir, ".ridgeline", "worktrees")
    fs.mkdirSync(worktreesDir, { recursive: true })

    execSync(
      `git worktree add ${path.join(worktreesDir, "test-build")} -b ridgeline/wip/test-build`,
      { cwd: repoDir, stdio: "pipe" }
    )

    expect(fs.existsSync(path.join(worktreesDir, "test-build"))).toBe(true)

    runClean(repoDir)

    expect(fs.existsSync(path.join(worktreesDir, "test-build"))).toBe(false)
    const branches = execSync("git branch", { cwd: repoDir, encoding: "utf-8" })
    expect(branches).not.toContain("ridgeline/wip/test-build")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/commands/__tests__/clean.test.ts`
Expected: FAIL — module `../clean` does not exist

- [ ] **Step 3: Implement the clean command**

Create `src/commands/clean.ts`:

```typescript
import { printInfo } from "../ui/output"
import { cleanAllWorktrees } from "../engine/worktree"

export const runClean = (repoRoot: string): void => {
  printInfo("Cleaning up worktrees...")
  cleanAllWorktrees(repoRoot)
  printInfo("Done.")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/commands/__tests__/clean.test.ts`
Expected: PASS

- [ ] **Step 5: Add clean command to CLI**

In `src/cli.ts`, add after the `build` command block:

```typescript
program
  .command("clean")
  .description("Remove all build worktrees and WIP branches")
  .action(() => {
    try {
      const { runClean } = require("./commands/clean")
      runClean(process.cwd())
    } catch (err) {
      console.error(`Error: ${err}`)
      process.exit(1)
    }
  })
```

- [ ] **Step 6: Run test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/commands/clean.ts src/commands/__tests__/clean.test.ts src/cli.ts
git commit -m "feat: add ridgeline clean command for worktree cleanup"
```

---

## Task 11: Network Guard Hook

**Files:**
- Create: `src/agents/core/hooks/network-guard.md`
- Modify: `src/engine/discovery/plugin.scan.ts`

- [ ] **Step 1: Create the hook file**

Create `src/agents/core/hooks/network-guard.md`:

```markdown
---
event: PreToolUse
tool: Bash
---
Block any bash command that makes outbound network requests.

Deny commands containing: curl, wget, nc, ncat, netcat, ssh, scp, sftp,
rsync (with remote paths), python -m http.server, node -e with http/https
modules, telnet, ftp.

Allow these exceptions:
- npm install, npm ci, npm update
- npx (any arguments)
- pip install, pip3 install
- cargo build, cargo install
- gem install, bundle install
- go get, go install, go mod download
- git fetch, git pull, git clone, git push
- brew install

If the command is blocked, return "block" with a message explaining that
network access is restricted. Suggest using an allowed package manager
command instead.
```

- [ ] **Step 2: Create plugin.json for the hooks directory**

The hook needs to live inside a valid Claude Code plugin directory. Create `src/agents/core/plugin.json`:

```json
{
  "name": "ridgeline-core",
  "description": "Ridgeline core hooks and agents"
}
```

- [ ] **Step 3: Update plugin discovery to include hook in unsafe mode**

In `src/engine/discovery/plugin.scan.ts`, add a function to get the core hooks plugin dir and update `discoverPluginDirs` to accept a config parameter for unsafe mode.

Add at the bottom of the file:

```typescript
export const getCorePluginDir = (): string | null => {
  const candidates = [
    path.join(__dirname, "..", "..", "agents", "core"),  // dist
    path.join(__dirname, "..", "..", "..", "agents", "core"),  // src
    path.join(__dirname, "..", "..", "..", "..", "src", "agents", "core"),  // dev fallback
  ]
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "hooks")) && fs.existsSync(path.join(dir, "plugin.json"))) {
      return dir
    }
  }
  return null
}
```

- [ ] **Step 4: Wire the hook into build/review executors when unsafe**

In `src/engine/pipeline/build.exec.ts`, after the existing plugin dir discovery, add:

```typescript
  // Include core hooks plugin when running in unsafe mode (no sandbox)
  if (config.unsafe && !config.sandboxProvider) {
    const { getCorePluginDir } = require("../discovery/plugin.scan")
    const coreDir = getCorePluginDir()
    if (coreDir) {
      pluginDirs.push({ dir: coreDir, createdPluginJson: false })
    }
  }
```

Do the same in `src/engine/pipeline/review.exec.ts`.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/agents/core/hooks/network-guard.md src/agents/core/plugin.json src/engine/discovery/plugin.scan.ts src/engine/pipeline/build.exec.ts src/engine/pipeline/review.exec.ts
git commit -m "feat: add network guard hook for unsafe mode"
```

---

## Task 12: Update Documentation

**Files:**
- Modify: `SECURITY.md`
- Modify: `docs/help.md`

- [ ] **Step 1: Update SECURITY.md**

Replace the "Sandbox mode (Linux)" section with a new "Sandbox mode" section describing auto-detection, Greywall, bwrap, `--unsafe`, and the network allowlist.

Replace the "Network access restrictions by default" section to describe the new default-deny posture.

Replace the "Filesystem write restrictions" section to mention worktree isolation.

Update the "Recommendations for users" section to mention installing Greywall on macOS.

- [ ] **Step 2: Update docs/help.md**

Update the CLI flag reference to replace `--sandbox`/`--allow-network` with `--unsafe`. Add `ridgeline clean` command.

- [ ] **Step 3: Run full test suite one final time**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add SECURITY.md docs/help.md
git commit -m "docs: update security and help docs for sandbox auto-detection"
```

---

## Task 13: Final Integration Verification

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 2: Build the project**

Run: `npm run build`
Expected: No TypeScript errors, clean build

- [ ] **Step 3: Verify CLI help**

Run: `npx tsx src/cli.ts --help`
Run: `npx tsx src/cli.ts build --help`
Run: `npx tsx src/cli.ts clean --help`

Expected: All show correct flags and descriptions

- [ ] **Step 4: Commit any remaining fixes**

If any fixes were needed, commit them:

```bash
git add -A
git commit -m "fix: integration issues from sandbox/worktree implementation"
```
