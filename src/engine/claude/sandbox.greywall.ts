import { SandboxProvider } from "./sandbox"

export const greywallProvider: SandboxProvider = {
  name: "greywall",
  command: "greywall",
  buildArgs(repoRoot: string, networkAllowlist: string[]): string[] {
    const args: string[] = [
      "--allow-dir", repoRoot,
      "--allow-dir", "/tmp",
    ]
    for (const domain of networkAllowlist) {
      args.push("--allow-network", domain)
    }
    args.push("--")
    return args
  },
}
