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
      if (output.includes("greyproxy running")) {
        return null
      }
      return "greyproxy is not running. Start it with: greywall setup"
    } catch {
      return "greywall check failed. Run 'greywall check' manually for details."
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
