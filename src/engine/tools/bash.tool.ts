import { spawn } from "node:child_process"
import { z } from "zod"
import { defineTool, type ToolFactoryContext } from "./types.js"

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000

/**
 * Live sandboxed children, tracked so a global teardown can reap stragglers if
 * the run is aborted (mirrors `claude-process.ts`'s `killAllClaudeSync`).
 */
const liveProcs = new Set<ReturnType<typeof spawn>>()

export const killAllBashSync = (): void => {
  for (const proc of liveProcs) {
    try {
      if (proc.pid) process.kill(-proc.pid, "SIGKILL")
    } catch {
      /* already gone */
    }
  }
  liveProcs.clear()
}

type RunOpts = {
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  abort: AbortSignal
}

const runSandboxedCommand = (
  spawnImpl: typeof spawn,
  binary: string,
  args: string[],
  opts: RunOpts,
): Promise<string> =>
  new Promise((resolve, reject) => {
    if (opts.abort.aborted) {
      reject(new Error("command aborted before start"))
      return
    }
    const proc = spawnImpl(binary, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    })
    liveProcs.add(proc)

    let stdout = ""
    let stderr = ""
    proc.stdout?.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    const killGroup = (signal: NodeJS.Signals): void => {
      try {
        if (proc.pid) process.kill(-proc.pid, signal)
      } catch {
        /* already gone */
      }
    }

    const cleanup = (): void => {
      clearTimeout(timer)
      opts.abort.removeEventListener("abort", onAbort)
      liveProcs.delete(proc)
    }

    const timer = setTimeout(() => {
      killGroup("SIGTERM")
      cleanup()
      reject(new Error(`command timed out after ${opts.timeoutMs}ms`))
    }, opts.timeoutMs)

    const onAbort = (): void => {
      killGroup("SIGTERM")
      cleanup()
      reject(new Error("command aborted"))
    }
    opts.abort.addEventListener("abort", onAbort, { once: true })

    proc.on("error", (err) => {
      cleanup()
      reject(err)
    })
    proc.on("close", (code) => {
      cleanup()
      if (code === 0) resolve(stdout + stderr)
      else reject(new Error(`exit ${code}: ${stderr.trim() || stdout.trim() || "<no output>"}`))
    })
  })

/**
 * Run a shell command inside the workspace, wrapped in ridgeline's greywall
 * sandbox. SECURITY-CRITICAL: the closure runs in ridgeline's own process, NOT
 * the Claude CLI's sandbox, so this tool must wrap the command in greywall
 * itself (same idiom as `ui/preflight.toolprobe.ts`): sync the network rules,
 * then exec `greywall <policy-args> -- bash -c <command>`. Denial is structural —
 * greywall blocks the syscall, the command exits non-zero, and this rejects so
 * fascicle surfaces a tool error rather than a false success.
 *
 * When no sandbox provider is active the command runs unwrapped; the surface
 * FACTORY is responsible for not emitting `Bash` to non-Claude providers in that
 * case (no unsandboxed Bash for AI-SDK providers).
 */
export const makeBashTool = (ctx: ToolFactoryContext) =>
  defineTool({
    name: "Bash",
    description:
      "Run a shell command inside the sandboxed workspace. Commands run from the workspace root; " +
      "writes outside it and network hosts outside the allowlist are blocked by the sandbox.",
    input_schema: z.object({
      command: z.string().describe("The shell command to run."),
      timeout: z.number().int().positive().max(MAX_TIMEOUT_MS).optional().describe("Timeout in ms."),
    }),
    execute: async (input, toolCtx) => {
      const provider = ctx.sandboxProvider
      // Populate the greyproxy network rules BEFORE spawning, so disallowed
      // hosts are refused for this command.
      if (provider?.syncRules) await provider.syncRules([...ctx.networkAllowlist])

      const spawnImpl = ctx.spawnFn ?? spawn
      const bashArgv = ["bash", "-c", input.command]
      const binary = provider ? provider.command : bashArgv[0]
      const args = provider
        ? [
            ...provider.buildArgs(ctx.cwd, [...ctx.networkAllowlist], {
              mode: ctx.sandboxMode,
              extras: ctx.sandboxExtras,
              additionalWritePaths: ctx.additionalWritePaths
                ? [...ctx.additionalWritePaths]
                : undefined,
            }),
            ...bashArgv,
          ]
        : bashArgv.slice(1)

      return runSandboxedCommand(spawnImpl, binary, args, {
        cwd: ctx.cwd,
        env: provider?.env ? { ...process.env, ...provider.env() } : process.env,
        timeoutMs: input.timeout ?? DEFAULT_TIMEOUT_MS,
        abort: toolCtx.abort,
      })
    },
  })
