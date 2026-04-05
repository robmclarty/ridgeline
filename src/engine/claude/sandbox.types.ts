export type SandboxProvider = {
  name: "bwrap" | "greywall"
  command: string
  buildArgs: (repoRoot: string, networkAllowlist: string[], additionalWritePaths?: string[]) => string[]
  /** Check if the sandbox is ready to use. Returns null if ready, or an error message. */
  checkReady?: () => string | null
}
