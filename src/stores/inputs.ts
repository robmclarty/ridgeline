import * as fs from "node:fs"
import * as path from "node:path"

// Resolve a file through the fallback chain: CLI flag > build-level > project-level
export const resolveFile = (
  cliFlag: string | undefined,
  buildDir: string,
  filename: string,
  projectDir: string
): string | null => {
  if (cliFlag && fs.existsSync(cliFlag)) return path.resolve(cliFlag)
  const buildLevel = path.join(buildDir, filename)
  if (fs.existsSync(buildLevel)) return buildLevel
  const projectLevel = path.join(projectDir, filename)
  if (fs.existsSync(projectLevel)) return projectLevel
  return null
}

// Parse the check command from constraints.md
export const parseCheckCommand = (constraintsPath: string): string | null => {
  try {
    const content = fs.readFileSync(constraintsPath, "utf-8")
    const match = content.match(/## Check Command\s*\n+```[^\n]*\n([\s\S]*?)```/)
    return match ? match[1].trim() : null
  } catch {
    return null
  }
}
