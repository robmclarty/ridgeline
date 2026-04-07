import * as fs from "node:fs"
import * as path from "node:path"

/**
 * Candidate paths for the built-in flavours directory, covering both compiled
 * (dist/) and source (src/) layouts.
 */
const resolveFlavoursRoot = (): string | null => {
  const candidates = [
    path.join(__dirname, "..", "flavours"),
    path.join(__dirname, "..", "..", "flavours"),
    path.join(__dirname, "..", "..", "..", "src", "flavours"),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir
  }
  return null
}

const looksLikePath = (value: string): boolean =>
  value.includes("/") || value.includes("\\") || value.startsWith(".") || value.startsWith("~")

/**
 * Resolve a flavour identifier to an absolute directory path.
 *
 * - If the value looks like a filesystem path (contains / or . or ~),
 *   resolve it against the current working directory.
 * - Otherwise treat it as a built-in flavour name and look it up
 *   under src/flavours/{name}/.
 * - Returns null when no flavour is specified.
 * - Throws when a flavour is specified but cannot be found.
 */
export const resolveFlavour = (flavour: string | null): string | null => {
  if (!flavour) return null

  if (looksLikePath(flavour)) {
    const resolved = path.resolve(flavour)
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`Flavour path not found: ${resolved}`)
    }
    return resolved
  }

  const root = resolveFlavoursRoot()
  if (!root) {
    throw new Error(`Built-in flavours directory not found — cannot resolve flavour "${flavour}"`)
  }

  const flavourDir = path.join(root, flavour)
  if (!fs.existsSync(flavourDir) || !fs.statSync(flavourDir).isDirectory()) {
    throw new Error(
      `Unknown flavour "${flavour}". Available flavours: ${listAvailableFlavours(root).join(", ") || "(none)"}`
    )
  }

  return flavourDir
}

const listAvailableFlavours = (root: string): string[] => {
  try {
    return fs.readdirSync(root).filter(entry => {
      const full = path.join(root, entry)
      return fs.statSync(full).isDirectory() && !entry.startsWith(".")
    })
  } catch {
    return []
  }
}
