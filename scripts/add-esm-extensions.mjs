// One-shot script to add .js extensions to relative imports/exports across src/.
// Required by Phase 8 ESM conversion (fascicle is ESM-only).
import * as fs from "node:fs"
import * as path from "node:path"

const ROOTS = [path.resolve("src"), path.resolve("test")]

const EXTENSIONS = [".ts", ".tsx"]
const SKIP_PATTERNS = []

const isPathExists = (target) => {
  for (const ext of EXTENSIONS) {
    if (fs.existsSync(target + ext)) return true
  }
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    for (const ext of EXTENSIONS) {
      if (fs.existsSync(path.join(target, "index" + ext))) return true
    }
  }
  return false
}

const resolveTargetType = (sourceFile, spec) => {
  const sourceDir = path.dirname(sourceFile)
  const target = path.resolve(sourceDir, spec)
  for (const ext of EXTENSIONS) {
    if (fs.existsSync(target + ext)) return "file"
  }
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    return "dir"
  }
  return "missing"
}

const rewriteSpec = (sourceFile, spec) => {
  if (/\.(js|mjs|cjs|json)$/.test(spec)) return null
  const type = resolveTargetType(sourceFile, spec)
  if (type === "file") return `${spec}.js`
  if (type === "dir") return `${spec}/index.js`
  return null
}

const transformLine = (line, sourceFile) => {
  let next = line.replace(
    /(from\s+["'])(\.\.?\/[^"']+?)(["'])/g,
    (match, prefix, spec, suffix) => {
      const rewritten = rewriteSpec(sourceFile, spec)
      return rewritten ? `${prefix}${rewritten}${suffix}` : match
    },
  )
  // dynamic and type-position import("...") — match within source line
  next = next.replace(
    /(import\s*\(\s*["'])(\.\.?\/[^"']+?)(["']\s*\))/g,
    (match, prefix, spec, suffix) => {
      const rewritten = rewriteSpec(sourceFile, spec)
      return rewritten ? `${prefix}${rewritten}${suffix}` : match
    },
  )
  // vi.mock("...") and similar literal specifiers — they expect a module path
  next = next.replace(
    /(vi\.(?:mock|doMock|hoisted|importMock|importActual)\s*\(\s*["'])(\.\.?\/[^"']+?)(["'])/g,
    (match, prefix, spec, suffix) => {
      const rewritten = rewriteSpec(sourceFile, spec)
      return rewritten ? `${prefix}${rewritten}${suffix}` : match
    },
  )
  return next
}

const transformFile = (filepath) => {
  const content = fs.readFileSync(filepath, "utf-8")
  const lines = content.split("\n")
  const newLines = lines.map((line) => transformLine(line, filepath))
  const next = newLines.join("\n")
  if (next !== content) {
    fs.writeFileSync(filepath, next)
    return true
  }
  return false
}

const walkDir = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fp = path.join(dir, entry.name)
    if (SKIP_PATTERNS.some((p) => p.test(fp))) continue
    if (entry.isDirectory()) {
      walkDir(fp)
    } else if (entry.isFile() && (fp.endsWith(".ts") || fp.endsWith(".tsx"))) {
      const changed = transformFile(fp)
      if (changed) console.log("✏ ", fp)
    }
  }
}

for (const root of ROOTS) {
  if (fs.existsSync(root)) walkDir(root)
}
console.log("done")
