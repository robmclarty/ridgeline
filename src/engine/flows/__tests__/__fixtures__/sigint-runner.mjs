import { run, compose, step } from "fascicle"
import { execFileSync, spawn } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

const repoRoot = process.argv[2]
const logPath = process.argv[3]
const childPidPath = process.argv[4]

if (!repoRoot || !logPath || !childPidPath) {
  console.error("usage: sigint-runner.mjs <repoRoot> <logPath> <childPidPath>")
  process.exit(2)
}

const gitArgs = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim()

const wtPath = path.join(repoRoot, ".test-worktrees", `wt-${process.pid}`)
const branchName = `sigint-test/${process.pid}`

const appendLog = (line) => {
  fs.appendFileSync(logPath, `${line}\n`)
}

const flow = compose(
  "sigint_test",
  step("sigint_test_inner", async (_input, ctx) => {
    fs.mkdirSync(path.dirname(wtPath), { recursive: true })
    gitArgs(["worktree", "add", wtPath, "-b", branchName], repoRoot)
    appendLog("worktree_created")

    const childProc = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
      detached: false,
    })
    fs.writeFileSync(childPidPath, String(childProc.pid))
    appendLog(`child_spawned ${childProc.pid}`)

    ctx.on_cleanup(async () => {
      appendLog("cleanup_start")
      try { childProc.kill("SIGTERM") } catch { /* already dead */ }
      try { gitArgs(["worktree", "remove", wtPath, "--force"], repoRoot) } catch { /* ignore */ }
      try { gitArgs(["branch", "-D", branchName], repoRoot) } catch { /* ignore */ }
      appendLog("cleanup_done")
    })

    appendLog("READY")

    return new Promise((_resolve, reject) => {
      const heartbeat = setInterval(() => undefined, 50)
      ctx.abort.addEventListener("abort", () => {
        clearInterval(heartbeat)
        reject(ctx.abort.reason)
      })
    })
  }),
)

const isAbortedError = (err) =>
  err !== null &&
  typeof err === "object" &&
  (err.kind === "aborted_error" || err.name === "aborted_error")

const start = async () => {
  try {
    await run(flow, {})
    process.exit(0)
  } catch (err) {
    if (isAbortedError(err)) {
      process.exit(130)
    }
    console.error("unexpected error:", err)
    process.exit(1)
  }
}

console.log("READY")
start()
