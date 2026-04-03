import { SandboxProvider } from "./sandbox"

// Placeholder: greywall provider will be implemented in a future task.
export const greywallProvider: SandboxProvider = {
  name: "greywall",
  command: "greywall",
  buildArgs(_repoRoot: string, _networkAllowlist: string[]): string[] {
    throw new Error("greywall provider not yet implemented")
  },
}
