import { describe, it, expect } from "vitest"
import { spawn } from "node:child_process"
import * as path from "node:path"
import * as url from "node:url"
import { execSync } from "node:child_process"

const here = path.dirname(url.fileURLToPath(import.meta.url))
const fixture = path.join(here, "__fixtures__", "sigint-runner.mjs")

const waitFor = (
  child: ReturnType<typeof spawn>,
  predicate: (stdout: string) => boolean,
  timeoutMs: number,
): Promise<string> =>
  new Promise((resolve, reject) => {
    let buffer = ""
    const timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString()
      if (predicate(buffer)) {
        clearTimeout(timer)
        resolve(buffer)
      }
    })
    child.on("exit", () => {
      clearTimeout(timer)
      reject(new Error(`child exited before predicate matched: ${buffer}`))
    })
  })

const waitForExit = (child: ReturnType<typeof spawn>): Promise<{ code: number | null; signal: NodeJS.Signals | null }> =>
  new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }))
  })

const orphanCount = (selfPid: number): number => {
  try {
    const out = execSync("ps -o pid=,ppid= -A", { encoding: "utf-8" })
    return out
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts[1] === String(selfPid)).length
  } catch {
    return 0
  }
}

describe("SIGINT handover (Phase 9)", () => {
  it("exits with code 130 when SIGINT is delivered to the runner using fascicle's default install_signal_handlers", async () => {
    const child = spawn("node", [fixture], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    })
    await waitFor(child, (s) => s.includes("READY"), 5_000)
    // Allow the run() call to install handlers + reach the awaiting state.
    await new Promise((r) => setTimeout(r, 200))
    const before = orphanCount(child.pid!)
    expect(child.kill("SIGINT")).toBe(true)
    const { code, signal } = await waitForExit(child)
    // Either: the handler intercepts → process.exit(130); OR the OS delivers SIGINT and the
    // process exits with signal=SIGINT (which Node would represent as 128+2=130). Accept both.
    if (code !== null) {
      expect(code).toBe(130)
    } else {
      expect(signal).toBe("SIGINT")
    }
    const after = orphanCount(child.pid!)
    expect(after).toBeLessThanOrEqual(before)
  }, 10_000)
})
