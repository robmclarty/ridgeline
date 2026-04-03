import { SandboxProvider } from "./sandbox"

export const bwrapProvider: SandboxProvider = {
  name: "bwrap",
  command: "bwrap",
  buildArgs(repoRoot: string, _networkAllowlist: string[]): string[] {
    return [
      "--ro-bind", "/", "/",
      "--bind", repoRoot, repoRoot,
      "--bind", "/tmp", "/tmp",
      "--dev", "/dev",
      "--proc", "/proc",
      "--die-with-parent",
      "--unshare-net",
    ]
  },
}
