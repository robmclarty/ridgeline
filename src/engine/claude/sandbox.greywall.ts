import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { SandboxProvider } from "./sandbox"

export const greywallProvider: SandboxProvider = {
  name: "greywall",
  command: "greywall",
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
