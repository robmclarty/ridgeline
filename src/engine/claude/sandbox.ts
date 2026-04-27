import { execFileSync } from "node:child_process"
import { bwrapProvider } from "./sandbox.bwrap"
import { greywallProvider } from "./sandbox.greywall"
import type { SandboxProvider } from "./sandbox.types"
import type { SandboxMode } from "../../stores/settings"
export type { SandboxProvider } from "./sandbox.types"

const isAvailable = (cmd: string): boolean => {
  try {
    execFileSync("which", [cmd], { stdio: ["pipe", "pipe", "pipe"] })
    return true
  } catch {
    return false
  }
}

type SandboxDetectionResult = {
  provider: SandboxProvider | null
  warning: string | null
}

/**
 * Resolve a sandbox provider for the requested mode.
 *
 * - `off`: explicit opt-out, returns no provider with no warning.
 * - `strict` / `semi-locked`: prefer greywall (cross-platform, domain allowlist),
 *   then bwrap on Linux. Both are configured by `mode` later via `buildArgs`.
 */
export const detectSandbox = (mode: SandboxMode = "semi-locked"): SandboxDetectionResult => {
  if (mode === "off") return { provider: null, warning: null }

  // Prefer greywall (cross-platform, supports domain allowlisting)
  if (isAvailable("greywall")) {
    const readyError = greywallProvider.checkReady?.() ?? null
    if (readyError) {
      return {
        provider: null,
        warning: `greywall is installed but not ready: ${readyError}\n         Running without sandbox.`,
      }
    }
    return { provider: greywallProvider, warning: null }
  }

  // Fall back to bwrap (Linux only, binary network toggle)
  if (process.platform === "linux" && isAvailable("bwrap")) {
    return { provider: bwrapProvider, warning: null }
  }

  return { provider: null, warning: null }
}
