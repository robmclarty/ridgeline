import * as fs from "node:fs"
import * as path from "node:path"
import { printInfo } from "../ui/output.js"
import { startDashboard, DashboardServer } from "../ui/dashboard/server.js"

export interface UiOptions {
  port?: number
}

export const DEFAULT_PORT = 4411

export const findMostRecentBuild = (cwd: string): string | null => {
  const buildsDir = path.join(cwd, ".ridgeline", "builds")
  if (!fs.existsSync(buildsDir)) return null
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(buildsDir, { withFileTypes: true })
  } catch {
    return null
  }
  const candidates = entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      const dir = path.join(buildsDir, e.name)
      let mtime = 0
      try { mtime = fs.statSync(dir).mtimeMs } catch { /* ignore */ }
      const stateJson = path.join(dir, "state.json")
      if (fs.existsSync(stateJson)) {
        try { mtime = Math.max(mtime, fs.statSync(stateJson).mtimeMs) } catch { /* ignore */ }
      }
      return { name: e.name, mtime }
    })
    .sort((a, b) => b.mtime - a.mtime)
  return candidates.length > 0 ? candidates[0].name : null
}

export const runUi = async (
  cwd: string,
  buildName: string | undefined,
  opts: UiOptions,
): Promise<DashboardServer> => {
  const resolvedBuildName = buildName ?? findMostRecentBuild(cwd)
  const buildDir = resolvedBuildName
    ? path.join(cwd, ".ridgeline", "builds", resolvedBuildName)
    : null
  const requestedPort = opts.port ?? DEFAULT_PORT

  const server = await startDashboard({
    buildName: resolvedBuildName,
    buildDir,
    port: requestedPort,
  })

  if (resolvedBuildName) {
    printInfo(`ridgeline ui attached to "${resolvedBuildName}"`)
  } else {
    printInfo("ridgeline ui: no build attached")
  }
  printInfo(`dashboard listening on ${server.url}`)

  return server
}
