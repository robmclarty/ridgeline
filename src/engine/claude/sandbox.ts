// src/engine/claude/sandbox.ts
import { execSync } from "node:child_process"

export const buildBwrapArgs = (repoRoot: string, allowNetwork: boolean): string[] => {
  const args: string[] = [
    "--ro-bind", "/", "/",
    "--bind", repoRoot, repoRoot,
    "--bind", "/tmp", "/tmp",
    "--dev", "/dev",
    "--proc", "/proc",
    "--die-with-parent",
  ]

  if (!allowNetwork) {
    args.push("--unshare-net")
  }

  return args
}

export const assertBwrapAvailable = (): void => {
  try {
    execSync("which bwrap", { stdio: ["pipe", "pipe", "pipe"] })
  } catch {
    throw new Error(
      "--sandbox requires bubblewrap (bwrap). Install it with your package manager " +
      "(e.g., apt install bubblewrap)."
    )
  }
}
