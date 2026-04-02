import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"

const EXCLUDED_DIRS = new Set([
  "node_modules", "dist", "build", ".git", ".next", "__pycache__",
  ".venv", "venv", "target", "vendor", ".ridgeline",
])

const MAX_DEPTH = 3

const walkDir = (dir: string, prefix: string, depth: number): string[] => {
  if (depth > MAX_DEPTH) return []
  const lines: string[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return lines
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (entry.name.startsWith(".") && depth === 0 && entry.name !== ".github") continue
    if (EXCLUDED_DIRS.has(entry.name)) continue
    if (entry.isDirectory()) {
      lines.push(`${prefix}${entry.name}/`)
      lines.push(...walkDir(path.join(dir, entry.name), prefix + "  ", depth + 1))
    } else {
      lines.push(`${prefix}${entry.name}`)
    }
  }
  return lines
}

const readFileSafe = (filepath: string, maxLines: number): string | null => {
  try {
    const content = fs.readFileSync(filepath, "utf-8")
    const lines = content.split("\n")
    if (lines.length > maxLines) {
      return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length - maxLines} more lines)`
    }
    return content
  } catch {
    return null
  }
}

const CONFIG_FILES = [
  "package.json", "tsconfig.json", "Cargo.toml", "pyproject.toml", "go.mod",
  ".eslintrc.json", ".eslintrc.js", "eslint.config.js", "eslint.config.mjs",
  "vite.config.ts", "vite.config.js", "next.config.js", "next.config.mjs",
  "webpack.config.js", "tailwind.config.js", "tailwind.config.ts",
]

const countSourceFiles = (dir: string): Map<string, number> => {
  const counts = new Map<string, number>()
  try {
    const output = execSync(
      "git ls-files --cached --others --exclude-standard",
      { cwd: dir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    )
    for (const file of output.split("\n").filter(Boolean)) {
      const dirName = path.dirname(file)
      counts.set(dirName, (counts.get(dirName) ?? 0) + 1)
    }
  } catch {
    // Not a git repo or no files
  }
  return counts
}

export const generateSnapshot = (projectDir: string, buildDir: string): string => {
  const sections: string[] = []

  // Directory tree
  sections.push("## Directory Tree\n")
  sections.push("```")
  sections.push(...walkDir(projectDir, "", 0))
  sections.push("```\n")

  // Config files
  sections.push("## Config Files\n")
  for (const configFile of CONFIG_FILES) {
    const fp = path.join(projectDir, configFile)
    const content = readFileSafe(fp, 50)
    if (content) {
      sections.push(`### ${configFile}\n`)
      sections.push("```")
      sections.push(content)
      sections.push("```\n")
    }
  }

  // Source file counts
  const fileCounts = countSourceFiles(projectDir)
  if (fileCounts.size > 0) {
    sections.push("## Source Files by Directory\n")
    const sorted = [...fileCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    for (const [dir, count] of sorted) {
      sections.push(`- ${dir}: ${count} files`)
    }
    sections.push("")
  }

  // Test structure
  const testDirs = ["test", "tests", "__tests__", "spec", "src/__tests__"]
  const foundTests: string[] = []
  for (const td of testDirs) {
    const fp = path.join(projectDir, td)
    if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) {
      foundTests.push(td)
    }
  }
  if (foundTests.length > 0) {
    sections.push("## Test Structure\n")
    sections.push(`Test directories: ${foundTests.join(", ")}`)
    sections.push("")
  }

  const snapshot = sections.join("\n")
  const snapshotPath = path.join(buildDir, "snapshot.md")
  fs.writeFileSync(snapshotPath, snapshot)
  return snapshot
}
