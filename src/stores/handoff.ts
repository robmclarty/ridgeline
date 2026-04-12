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

/** Create a phase-specific handoff fragment for parallel execution. Returns the path. */
export const ensurePhaseHandoffExists = (buildDir: string, phaseId: string): string => {
  const fp = path.join(buildDir, `handoff-${phaseId}.md`)
  if (!fs.existsSync(fp)) {
    fs.writeFileSync(fp, "")
  }
  return fp
}

/** Consolidate per-phase handoff fragments into the main handoff.md, in order. */
export const consolidateHandoffs = (buildDir: string, phaseIds: string[]): void => {
  const mainPath = path.join(buildDir, "handoff.md")
  const existing = fs.existsSync(mainPath) ? fs.readFileSync(mainPath, "utf-8") : ""
  const fragments: string[] = existing ? [existing] : []

  for (const phaseId of phaseIds) {
    const fp = path.join(buildDir, `handoff-${phaseId}.md`)
    if (fs.existsSync(fp)) {
      const content = fs.readFileSync(fp, "utf-8").trim()
      if (content) {
        fragments.push(content)
      }
      fs.unlinkSync(fp)
    }
  }

  fs.writeFileSync(mainPath, fragments.join("\n\n") + "\n")
}
