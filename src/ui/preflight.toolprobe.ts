import { spawn } from "node:child_process"
import type { SandboxProvider } from "../engine/claude/sandbox.types"
import type { SandboxMode, SandboxExtras } from "../stores/settings"
import type { SensorName } from "../engine/detect"

const PROBE_TIMEOUT_MS = 30_000

type ToolProbeResult = {
  tool: string
  isLaunchable: boolean
  detail: string
}

type ProbeOptions = {
  cwd: string
  sandboxProvider: SandboxProvider | null
  sandboxMode: SandboxMode
  sandboxExtras: SandboxExtras
  /** Optional override for testing — replace the spawn call. */
  spawnFn?: typeof spawn
}

type Cmd = { binary: string; args: string[] }

/**
 * Spawn a probe command, optionally wrapped in the active sandbox provider.
 * Resolves with combined stdout+stderr; rejects on non-zero exit or timeout.
 */
const runProbe = (cmd: Cmd, opts: ProbeOptions): Promise<string> =>
  new Promise((resolve, reject) => {
    const provider = opts.sandboxProvider
    const spawnImpl = opts.spawnFn ?? spawn

    const finalBinary = provider ? provider.command : cmd.binary
    const finalArgs = provider
      ? [
          ...provider.buildArgs(opts.cwd, [], {
            mode: opts.sandboxMode,
            extras: opts.sandboxExtras,
          }),
          cmd.binary,
          ...cmd.args,
        ]
      : cmd.args

    const proc = spawnImpl(finalBinary, finalArgs, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    proc.stdout?.on("data", (chunk) => { stdout += chunk.toString() })
    proc.stderr?.on("data", (chunk) => { stderr += chunk.toString() })

    const timer = setTimeout(() => {
      proc.kill("SIGTERM")
      reject(new Error(`probe timed out after ${PROBE_TIMEOUT_MS / 1000}s`))
    }, PROBE_TIMEOUT_MS)

    proc.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })

    proc.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve(stdout + stderr)
      } else {
        reject(new Error(`exit ${code}: ${stderr.trim() || stdout.trim() || "<no output>"}`))
      }
    })
  })

/**
 * Smoke-test that Chromium can launch under the active sandbox.
 *
 * The probe runs the same launch path the playwright sensor uses — if this
 * passes, the sensor will too. If it fails, the build would silently fall back
 * to jsdom (or skip browser tests entirely), so we abort.
 */
const probePlaywright = async (opts: ProbeOptions): Promise<ToolProbeResult> => {
  // Inline JS keeps the probe self-contained — no fixture file to keep in sync.
  const script =
    "const pw=require('playwright');" +
    "pw.chromium.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']})" +
    ".then(b=>b.close()).then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)})"
  try {
    await runProbe({ binary: "node", args: ["-e", script] }, opts)
    return { tool: "playwright", isLaunchable: true, detail: "chromium launched cleanly" }
  } catch (err) {
    return {
      tool: "playwright",
      isLaunchable: false,
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

const SENSOR_REQUIRES_PROBE = new Set<SensorName>(["playwright", "a11y"])

/**
 * Probe every suggested sensor that requires a real binary launch under
 * the sandbox. Returns one result per probed tool.
 *
 * Skips probing entirely when sandboxMode is "off" — there's no sandbox to
 * fail under, and the host-resolvable check in renderPreflight already covers
 * "is the binary installed at all."
 */
export const probeSensorsUnderSandbox = async (
  sensors: readonly SensorName[],
  opts: ProbeOptions,
): Promise<ToolProbeResult[]> => {
  if (opts.sandboxMode === "off") return []

  const results: ToolProbeResult[] = []
  // playwright + a11y both depend on chromium, so a single playwright probe
  // covers both. Avoid duplicating the launch (each takes ~5s).
  const needsBrowser = sensors.some((s) => SENSOR_REQUIRES_PROBE.has(s))
  if (needsBrowser) {
    results.push(await probePlaywright(opts))
  }
  return results
}

/**
 * Format a probe-failure abort message that names the tool, the failure mode,
 * and the remediation paths the user has.
 */
export const formatProbeAbortMessage = (failures: ToolProbeResult[]): string => {
  const lines: string[] = [
    "",
    "Pre-flight tool probe failed. Aborting before any phase runs to avoid wasted budget on a degraded foundation.",
    "",
  ]
  for (const f of failures) {
    lines.push(`  ${f.tool}: ${f.detail}`)
  }
  lines.push("")
  lines.push("To proceed, choose one of:")
  lines.push("  1. Fix the underlying tool installation (e.g., reinstall playwright, restart agent-browser).")
  lines.push("  2. Loosen the sandbox: add the missing path to sandbox.extraWritePaths in .ridgeline/settings.json.")
  lines.push("  3. Disable the sandbox for this build: --sandbox=off (less safe).")
  lines.push("")
  return lines.join("\n")
}
