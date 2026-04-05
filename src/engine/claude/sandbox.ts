import { execFileSync } from "node:child_process"
import { bwrapProvider } from "./sandbox.bwrap"
import { greywallProvider } from "./sandbox.greywall"
import type { SandboxProvider } from "./sandbox.types"
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

export const detectSandbox = (): SandboxDetectionResult => {
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
