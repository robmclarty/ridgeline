import { execSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { SandboxProvider } from "./sandbox"

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
  buildArgs(repoRoot: string, _networkAllowlist: string[]): string[] {
    const settings = {
      filesystem: {
        allowWrite: [repoRoot, "/tmp"],
      },
    }

    const settingsPath = join(tmpdir(), `ridgeline-greywall-${process.pid}.json`)
    writeFileSync(settingsPath, JSON.stringify(settings))

    return ["--settings", settingsPath, "--"]
  },
}
