import { describe, it, expect, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { withFileLock } from "../file-lock.js"
import { makeTempDir } from "../../../test/setup.js"

describe("withFileLock", () => {
  let tmpDir: string

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("executes the function and returns its result", () => {
    tmpDir = makeTempDir()
    const lockPath = path.join(tmpDir, "test.lock")

    const result = withFileLock(lockPath, () => 42)

    expect(result).toBe(42)
    // Lock file should be cleaned up
    expect(fs.existsSync(lockPath)).toBe(false)
  })

  it("cleans up lock file even when fn throws", () => {
    tmpDir = makeTempDir()
    const lockPath = path.join(tmpDir, "test.lock")

    expect(() => {
      withFileLock(lockPath, () => { throw new Error("boom") })
    }).toThrow("boom")

    expect(fs.existsSync(lockPath)).toBe(false)
  })

  it("allows re-acquisition after release", () => {
    tmpDir = makeTempDir()
    const lockPath = path.join(tmpDir, "test.lock")

    const r1 = withFileLock(lockPath, () => "first")
    const r2 = withFileLock(lockPath, () => "second")

    expect(r1).toBe("first")
    expect(r2).toBe("second")
  })

  it("detects and removes stale lock files", () => {
    tmpDir = makeTempDir()
    const lockPath = path.join(tmpDir, "stale.lock")

    // Create a stale lock (set mtime to 2 minutes ago)
    fs.writeFileSync(lockPath, "12345")
    const past = new Date(Date.now() - 120_000)
    fs.utimesSync(lockPath, past, past)

    const result = withFileLock(lockPath, () => "recovered")
    expect(result).toBe("recovered")
  })
})
