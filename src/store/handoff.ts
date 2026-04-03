import * as fs from "node:fs"
import * as path from "node:path"

export const readHandoff = (buildDir: string): string => {
  const fp = path.join(buildDir, "handoff.md")
  if (fs.existsSync(fp)) {
    return fs.readFileSync(fp, "utf-8")
  }
  return ""
}

export const ensureHandoffExists = (buildDir: string): void => {
  const fp = path.join(buildDir, "handoff.md")
  if (!fs.existsSync(fp)) {
    fs.writeFileSync(fp, "")
  }
}
