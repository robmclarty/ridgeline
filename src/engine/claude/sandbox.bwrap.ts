import { SandboxProvider } from "./sandbox.types"

export const bwrapProvider: SandboxProvider = {
  name: "bwrap",
  command: "bwrap",
  buildArgs(repoRoot: string, _networkAllowlist: string[], additionalWritePaths?: string[]): string[] {
    const extraBinds = (additionalWritePaths ?? []).flatMap((p) => ["--bind", p, p])
    return [
      "--ro-bind", "/", "/",
      "--bind", repoRoot, repoRoot,
      ...extraBinds,
      "--bind", "/tmp", "/tmp",
      "--dev", "/dev",
      "--proc", "/proc",
      "--die-with-parent",
      "--unshare-net",
    ]
  },
}
