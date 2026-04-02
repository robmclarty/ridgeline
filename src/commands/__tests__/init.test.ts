import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { EventEmitter } from "node:events"
import { makeTempDir } from "../../../test/setup"

vi.mock("node:child_process", () => {
  const EventEmitter = require("node:events")
  return {
    spawn: vi.fn(() => {
      const proc = new EventEmitter()
      proc.stdin = { write: vi.fn(), end: vi.fn() }
      proc.stdout = new EventEmitter()
      proc.stderr = new EventEmitter()
      return proc
    }),
  }
})

vi.mock("../../logging", () => ({
  logInfo: vi.fn(),
}))

import { spawn } from "node:child_process"
import { runInit } from "../init"

describe("commands/init", () => {
  let origCwd: string
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    origCwd = process.cwd()
    tmpDir = makeTempDir()
    process.chdir(tmpDir)
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("creates build directory structure", async () => {
    const promise = runInit("my-build")

    // Simulate claude CLI exiting successfully
    const proc = vi.mocked(spawn).mock.results[0].value
    proc.emit("close", 0)

    await promise

    const phasesDir = path.join(tmpDir, ".ridgeline", "builds", "my-build", "phases")
    expect(fs.existsSync(phasesDir)).toBe(true)
  })

  it("spawns claude with system prompt and allowed tools", async () => {
    const promise = runInit("my-build")

    expect(spawn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["--allowedTools", "Write,Read"]),
      expect.objectContaining({ stdio: "inherit" })
    )

    const proc = vi.mocked(spawn).mock.results[0].value
    proc.emit("close", 0)

    await promise
  })

  it("rejects when claude exits with non-zero code", async () => {
    const promise = runInit("my-build")

    const proc = vi.mocked(spawn).mock.results[0].value
    proc.emit("close", 1)

    await expect(promise).rejects.toThrow("exited with code 1")
  })

  it("rejects when claude fails to start", async () => {
    const promise = runInit("my-build")

    const proc = vi.mocked(spawn).mock.results[0].value
    proc.emit("error", new Error("command not found"))

    await expect(promise).rejects.toThrow("Failed to start claude CLI")
  })
})
