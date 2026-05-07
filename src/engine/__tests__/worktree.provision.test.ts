import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  provisionPhaseWorktree,
  KNOWN_BINARY_FIXES,
  type BinaryFix,
} from "../worktree.provision.js"
import { readDiscoveries } from "../pipeline/discoveries.js"

describe("worktree.provision", () => {
  let mainCwd: string
  let wtPath: string

  const writeFile = (root: string, rel: string, content = "binary"): void => {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }

  const fakeFix = (overrides: Partial<BinaryFix> = {}): BinaryFix => ({
    pkg: "agnix",
    binPath: "bin/agnix-binary",
    why: "test fixture",
    ...overrides,
  })

  beforeEach(() => {
    mainCwd = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-prov-main-"))
    wtPath = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-prov-wt-"))
  })

  afterEach(() => {
    fs.rmSync(mainCwd, { recursive: true, force: true })
    fs.rmSync(wtPath, { recursive: true, force: true })
  })

  it("symlinks a missing binary from main into the worktree", () => {
    writeFile(mainCwd, "node_modules/agnix/bin/agnix-binary", "real binary")
    fs.mkdirSync(path.join(wtPath, "node_modules/agnix"), { recursive: true })

    const results = provisionPhaseWorktree(wtPath, mainCwd, { fixes: [fakeFix()] })

    expect(results).toHaveLength(1)
    expect(results[0].applied).toBe(true)
    const wtBin = path.join(wtPath, "node_modules/agnix/bin/agnix-binary")
    expect(fs.lstatSync(wtBin).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(wtBin, "utf-8")).toBe("real binary")
  })

  it("skips when the binary already exists in the worktree", () => {
    writeFile(mainCwd, "node_modules/agnix/bin/agnix-binary", "real binary")
    writeFile(wtPath, "node_modules/agnix/bin/agnix-binary", "existing")

    const results = provisionPhaseWorktree(wtPath, mainCwd, { fixes: [fakeFix()] })

    expect(results[0].applied).toBe(false)
    expect(results[0].detail).toContain("already present")
    // Existing file untouched
    expect(fs.readFileSync(path.join(wtPath, "node_modules/agnix/bin/agnix-binary"), "utf-8"))
      .toBe("existing")
  })

  it("skips when the package isn't installed in the worktree", () => {
    writeFile(mainCwd, "node_modules/agnix/bin/agnix-binary", "real binary")
    // Worktree has no node_modules/agnix at all
    const results = provisionPhaseWorktree(wtPath, mainCwd, { fixes: [fakeFix()] })
    expect(results[0].applied).toBe(false)
    expect(results[0].detail).toContain("not installed")
  })

  it("skips when main has no source binary to mirror from", () => {
    fs.mkdirSync(path.join(wtPath, "node_modules/agnix"), { recursive: true })
    const results = provisionPhaseWorktree(wtPath, mainCwd, { fixes: [fakeFix()] })
    expect(results[0].applied).toBe(false)
    expect(results[0].detail).toContain("no source binary")
  })

  it("replaces a dangling symlink in the worktree", () => {
    writeFile(mainCwd, "node_modules/agnix/bin/agnix-binary", "real binary")
    fs.mkdirSync(path.join(wtPath, "node_modules/agnix/bin"), { recursive: true })
    const wtBin = path.join(wtPath, "node_modules/agnix/bin/agnix-binary")
    fs.symlinkSync("/nonexistent/target", wtBin)

    const results = provisionPhaseWorktree(wtPath, mainCwd, { fixes: [fakeFix()] })
    expect(results[0].applied).toBe(true)
    expect(fs.readFileSync(wtBin, "utf-8")).toBe("real binary")
  })

  it("logs an applied fix to discoveries.jsonl when buildDir is provided", () => {
    writeFile(mainCwd, "node_modules/agnix/bin/agnix-binary", "real binary")
    fs.mkdirSync(path.join(wtPath, "node_modules/agnix"), { recursive: true })
    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-prov-build-"))

    try {
      provisionPhaseWorktree(wtPath, mainCwd, {
        fixes: [fakeFix({ why: "agnix postinstall blocked by sandbox" })],
        phaseId: "02-sandbox-policy",
        buildDir,
      })

      const entries = readDiscoveries(buildDir)
      expect(entries).toHaveLength(1)
      expect(entries[0].source).toBe("auto")
      expect(entries[0].phase_id).toBe("02-sandbox-policy")
      expect(entries[0].blocker).toContain("agnix")
      expect(entries[0].solution).toContain("symlinked")
    } finally {
      fs.rmSync(buildDir, { recursive: true, force: true })
    }
  })

  it("does NOT log skipped fixes to discoveries", () => {
    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-prov-build-"))
    try {
      // No source binary in main → fix is skipped
      fs.mkdirSync(path.join(wtPath, "node_modules/agnix"), { recursive: true })
      provisionPhaseWorktree(wtPath, mainCwd, {
        fixes: [fakeFix()],
        phaseId: "02-sandbox-policy",
        buildDir,
      })
      expect(readDiscoveries(buildDir)).toEqual([])
    } finally {
      fs.rmSync(buildDir, { recursive: true, force: true })
    }
  })

  it("ships agnix in the default fix list", () => {
    expect(KNOWN_BINARY_FIXES.find((f) => f.pkg === "agnix")).toBeDefined()
  })
})
