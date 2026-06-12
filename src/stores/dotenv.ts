import { existsSync } from "node:fs"
import { homedir } from "node:os"
import * as path from "node:path"
import { loadEnvFile } from "node:process"

/**
 * Candidate `.env` paths, in precedence order (first to set a key wins).
 *
 * Deliberately NOT the project-root `./.env`: ridgeline runs *inside* other
 * projects that frequently keep their own `./.env` of application secrets, and
 * slurping those into ridgeline's process would be surprising and a needless
 * secrets-bleed. Keys live in a ridgeline-namespaced file instead — `.ridgeline/.env`
 * (per-project, sibling of settings.json) overrides `~/.config/ridgeline/.env`
 * (global, "one OpenRouter key for every project").
 */
export const dotenvCandidates = (cwd: string = process.cwd()): string[] => {
  const xdg = process.env.XDG_CONFIG_HOME?.trim()
  const globalDir = xdg ? path.join(xdg, "ridgeline") : path.join(homedir(), ".config", "ridgeline")
  return [path.join(cwd, ".ridgeline", ".env"), path.join(globalDir, ".env")]
}

/**
 * Load ridgeline's `.env` files into `process.env` before any provider key is read.
 *
 * Uses the Node 24 built-in `process.loadEnvFile` — no `dotenv` dependency.
 * `loadEnvFile` never overrides an already-set variable, so the resolved
 * precedence is: real env > `.ridgeline/.env` > `~/.config/ridgeline/.env`.
 *
 * Missing files are skipped. A file that exists but is malformed throws (with
 * its path) rather than being silently swallowed — a broken key file should
 * surface loudly, not strand the user wondering why their provider is "unset".
 */
export const loadDotenvFiles = (cwd: string = process.cwd()): void => {
  for (const file of dotenvCandidates(cwd)) {
    if (!existsSync(file)) continue
    try {
      loadEnvFile(file)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new Error(`Failed to load env file ${file}: ${reason}`)
    }
  }
}
