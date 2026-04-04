import { execFileSync } from "node:child_process"
import { bwrapProvider } from "./sandbox.bwrap"
import { greywallProvider } from "./sandbox.greywall"

export type SandboxProvider = {
  name: "bwrap" | "greywall"
  command: string
  buildArgs: (repoRoot: string, networkAllowlist: string[]) => string[]
  /** Check if the sandbox is ready to use. Returns null if ready, or an error message. */
  checkReady?: () => string | null
}

const isAvailable = (cmd: string): boolean => {
  try {
    execFileSync("which", [cmd], { stdio: ["pipe", "pipe", "pipe"] })
    return true
  } catch {
    return false
  }
}

export const detectSandbox = (): SandboxProvider | null => {
  // Prefer greywall (cross-platform, supports domain allowlisting)
  if (isAvailable("greywall")) {
    const readyError = greywallProvider.checkReady?.() ?? null
    if (readyError) {
      throw new Error(`Sandbox 'greywall' is installed but not ready: ${readyError}`)
    }
    return greywallProvider
  }

  // Fall back to bwrap (Linux only, binary network toggle)
  if (process.platform === "linux" && isAvailable("bwrap")) {
    return bwrapProvider
  }

  return null
}
