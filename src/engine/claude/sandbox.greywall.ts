import { execSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir, homedir } from "node:os"
import { SandboxProvider } from "./sandbox.types"

/** Directories package managers need write access to for caching. */
const packageManagerCachePaths = (): string[] => {
  const home = homedir()
  return [
    join(home, ".npm"),           // npm
    join(home, ".cache"),         // pip, yarn berry, pnpm, misc
    join(home, ".yarn"),          // yarn classic
    join(home, ".pnpm-store"),    // pnpm
    join(home, ".cargo"),         // cargo
    join(home, ".local", "share"), // pip user installs, various tools
  ]
}

export const greywallProvider: SandboxProvider = {
  name: "greywall",
  command: "greywall",
  checkReady(): string | null {
    try {
      const output = execSync("greywall check", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
      if (/✓.*greyproxy running/i.test(output)) {
        return null
      }
      return "greyproxy is not running. Start it with: greywall setup"
    } catch (err: unknown) {
      // greywall check exits non-zero when not ready — check stdout/stderr in the error
      const output = (err as { stdout?: string; stderr?: string }).stdout ?? ""
        + ((err as { stdout?: string; stderr?: string }).stderr ?? "")
      if (/✓.*greyproxy running/i.test(output)) {
        return null
      }
      return "greyproxy is not running. Start it with: greywall setup"
    }
  },
  buildArgs(repoRoot: string, networkAllowlist: string[], additionalWritePaths?: string[]): string[] {
    const writePaths = [repoRoot, "/tmp", ...packageManagerCachePaths(), ...(additionalWritePaths ?? [])]
    const settings: Record<string, unknown> = {
      filesystem: {
        allowWrite: writePaths,
      },
    }

    if (networkAllowlist.length > 0) {
      settings.network = { allowlist: networkAllowlist }
    }

    const settingsPath = join(tmpdir(), `ridgeline-greywall-${process.pid}.json`)
    writeFileSync(settingsPath, JSON.stringify(settings))

    return ["--auto-profile", "--no-credential-protection", "--settings", settingsPath, "--"]
  },
}
