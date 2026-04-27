import { SandboxBuildArgsOptions, SandboxProvider } from "./sandbox.types"

export const bwrapProvider: SandboxProvider = {
  name: "bwrap",
  command: "bwrap",
  buildArgs(
    repoRoot: string,
    _networkAllowlist: string[],
    options?: SandboxBuildArgsOptions,
  ): string[] {
    const extras = options?.extras
    const additionalWritePaths = options?.additionalWritePaths ?? []
    const extraWritePaths = [
      ...(extras?.writePaths ?? []),
      ...additionalWritePaths,
    ]
    const extraBinds = extraWritePaths.flatMap((p) => ["--bind", p, p])
    const extraReadBinds = (extras?.readPaths ?? []).flatMap((p) => ["--ro-bind", p, p])
    return [
      "--ro-bind", "/", "/",
      "--bind", repoRoot, repoRoot,
      ...extraBinds,
      ...extraReadBinds,
      "--bind", "/tmp", "/tmp",
      "--dev", "/dev",
      "--proc", "/proc",
      "--die-with-parent",
      "--unshare-net",
    ]
  },
}
