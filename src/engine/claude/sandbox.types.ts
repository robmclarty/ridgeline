export type SandboxProvider = {
  name: "bwrap" | "greywall"
  command: string
  buildArgs: (repoRoot: string, networkAllowlist: string[], additionalWritePaths?: string[]) => string[]
  /** Check if the sandbox is ready to use. Returns null if ready, or an error message. */
  checkReady?: () => string | null
  /** Sync network allowlist rules with the proxy before spawning the sandboxed process. */
  syncRules?: (networkAllowlist: string[]) => Promise<void>
  /** Env overrides merged into the spawned subprocess. Used to redirect tool
   *  user-config reads (pnpm/npm/etc.) away from paths the sandbox denies, so
   *  package managers can run without allow-reading credential dotfiles. */
  env?: () => Record<string, string>
}
