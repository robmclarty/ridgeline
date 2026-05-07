import { describe, it, expect } from "vitest"
import { spawn, execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as url from "node:url"
import { initTestRepo } from "../../../../test/setup.js"

const here = path.dirname(url.fileURLToPath(import.meta.url))
const fixture = path.join(here, "__fixtures__", "sigint-runner.mjs")

const waitForLogLine = async (
  logPath: string,
  needle: string,
  timeoutMs: number,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, "utf-8")
      if (content.includes(needle)) return
    }
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(`timeout waiting for "${needle}" in ${logPath}`)
}

const waitForExit = (
  child: ReturnType<typeof spawn>,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> =>
  new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }))
  })

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return false
    // EPERM means process exists but we can't signal it. Treat as alive.
    return true
  }
}

const setupTempRepo = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-sigint-test-"))
  initTestRepo(dir)
  fs.writeFileSync(path.join(dir, "README.md"), "test\n")
  execFileSync("git", ["add", "."], { cwd: dir })
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "initial"], {
    cwd: dir,
  })
  return dir
}

const listWorktrees = (repoRoot: string): string[] => {
  try {
    const out = execFileSync("git", ["worktree", "list"], {
      cwd: repoRoot,
      encoding: "utf-8",
    })
    return out.split("\n").filter(Boolean)
  } catch {
    return []
  }
}

describe("SIGINT regression (Phase 9)", () => {
  it("on SIGINT mid-run: exits 130, removes the worktree, kills the spawned child, and runs cleanup exactly once", async () => {
    const repoRoot = setupTempRepo()
    const logPath = path.join(repoRoot, "sigint.log")
    const childPidPath = path.join(repoRoot, "child.pid")

    const fixtureChild = spawn(
      process.execPath,
      [fixture, repoRoot, logPath, childPidPath],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, NODE_NO_WARNINGS: "1" },
      },
    )

    try {
      // Wait until the fixture has created the worktree, spawned the child,
      // registered cleanup, and is awaiting abort.
      await waitForLogLine(logPath, "READY", 10_000)

      // Verify worktree was actually created (filesystem proof).
      const wtListBefore = listWorktrees(repoRoot)
      expect(wtListBefore.some((line) => line.includes(".test-worktrees"))).toBe(true)

      // Read the spawned child's PID and verify it's alive (non-vacuous proof).
      const childPid = Number(fs.readFileSync(childPidPath, "utf-8").trim())
      expect(Number.isInteger(childPid)).toBe(true)
      expect(isProcessAlive(childPid)).toBe(true)

      // Send SIGINT.
      expect(fixtureChild.kill("SIGINT")).toBe(true)
      const { code, signal } = await waitForExit(fixtureChild)

      // (a) Exit code 130 — fascicle's install_signal_handlers default routes SIGINT
      // through aborted_error and the fixture's catch maps that to process.exit(130).
      // OS-level signal delivery can also surface as signal=SIGINT (Node represents
      // both equivalently); accept either.
      if (code !== null) {
        expect(code).toBe(130)
      } else {
        expect(signal).toBe("SIGINT")
      }

      // Wait briefly for cleanup-async work to flush its log line.
      await waitForLogLine(logPath, "cleanup_done", 5_000)
      const log = fs.readFileSync(logPath, "utf-8")

      // (d) cleanup ran exactly once — no double-teardown.
      const cleanupStartMatches = log.match(/cleanup_start/g) ?? []
      const cleanupDoneMatches = log.match(/cleanup_done/g) ?? []
      expect(cleanupStartMatches.length).toBe(1)
      expect(cleanupDoneMatches.length).toBe(1)

      // (b) Worktree was removed by cleanup.
      const wtListAfter = listWorktrees(repoRoot)
      expect(wtListAfter.some((line) => line.includes(".test-worktrees"))).toBe(false)

      // (c) Spawned child is gone — verified non-vacuously via process.kill(pid, 0).
      // Give the OS a beat to reap the killed process.
      await new Promise((r) => setTimeout(r, 200))
      expect(isProcessAlive(childPid)).toBe(false)
    } finally {
      if (!fixtureChild.killed) {
        try { fixtureChild.kill("SIGKILL") } catch { /* ignore */ }
      }
      fs.rmSync(repoRoot, { recursive: true, force: true })
    }
  }, 30_000)
})
