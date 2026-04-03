import { execFileSync } from "node:child_process"
import { bwrapProvider } from "./sandbox.bwrap"
import { greywallProvider } from "./sandbox.greywall"

export type SandboxProvider = {
  name: "bwrap" | "greywall"
  command: string
  buildArgs: (repoRoot: string, networkAllowlist: string[]) => string[]
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
    return greywallProvider
  }

  // Fall back to bwrap (Linux only, binary network toggle)
  if (process.platform === "linux" && isAvailable("bwrap")) {
    return bwrapProvider
  }

  return null
}
