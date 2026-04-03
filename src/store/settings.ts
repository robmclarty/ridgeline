import * as fs from "node:fs"
import * as path from "node:path"

export const DEFAULT_NETWORK_ALLOWLIST: string[] = [
  "registry.npmjs.org",
  "pypi.org",
  "files.pythonhosted.org",
  "crates.io",
  "static.crates.io",
  "rubygems.org",
  "proxy.golang.org",
  "github.com",
  "gitlab.com",
  "bitbucket.org",
]

export type RidgelineSettings = {
  network?: {
    allowlist?: string[]
  }
}

export const loadSettings = (ridgelineDir: string): RidgelineSettings => {
  const settingsPath = path.join(ridgelineDir, "settings.json")
  try {
    const raw = fs.readFileSync(settingsPath, "utf-8")
    return JSON.parse(raw) as RidgelineSettings
  } catch {
    return {}
  }
}

export const resolveNetworkAllowlist = (ridgelineDir: string): string[] => {
  const settings = loadSettings(ridgelineDir)
  if (settings.network?.allowlist && settings.network.allowlist.length > 0) {
    return settings.network.allowlist
  }
  return [...DEFAULT_NETWORK_ALLOWLIST]
}
