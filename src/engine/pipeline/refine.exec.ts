import * as fs from "node:fs"
import * as path from "node:path"
import { ClaudeResult } from "../../types"
import { invokeClaude } from "../claude/claude.exec"
import { createDisplayCallbacks } from "../claude/stream.display"
import { buildAgentRegistry } from "../discovery/agent.registry"
import { resolveFlavour } from "../discovery/flavour.resolve"
import { createStderrHandler } from "./pipeline.shared"
import { assembleInputSections } from "./research.exec"

// ---------------------------------------------------------------------------
// Refine executor
// ---------------------------------------------------------------------------

export type RefineConfig = {
  model: string
  timeoutMinutes: number
  buildDir: string
  flavour: string | null
  changelogMd: string | null
  iterationNumber: number
}

export const invokeRefiner = async (
  specMd: string,
  researchMd: string,
  constraintsMd: string,
  tasteMd: string | null,
  config: RefineConfig,
): Promise<ClaudeResult> => {
  const registry = buildAgentRegistry(resolveFlavour(config.flavour))
  const systemPrompt = registry.getCorePrompt("refiner.md")

  const sections = assembleInputSections(specMd, constraintsMd, tasteMd)

  // Insert research.md after spec.md section
  const constraintsIdx = sections.indexOf("## constraints.md\n")
  sections.splice(constraintsIdx, 0, "## research.md\n", researchMd, "")

  // Insert spec.changelog.md after research.md (if it exists)
  if (config.changelogMd) {
    const newConstraintsIdx = sections.indexOf("## constraints.md\n")
    sections.splice(newConstraintsIdx, 0, "## spec.changelog.md (your prior changes)\n", config.changelogMd, "")
  }

  sections.push("## Output\n")
  sections.push(`1. Rewrite the spec incorporating research findings. Write the revised spec to: ${config.buildDir}/spec.md`)
  sections.push(`2. Document your changes. Write the changelog to: ${config.buildDir}/spec.changelog.md`)
  sections.push(`   - ${config.changelogMd ? "Read the existing spec.changelog.md first, then prepend" : "Create"} a new ## Iteration ${config.iterationNumber} section.`)
  sections.push("Use the Write tool for both files.")

  const userPrompt = sections.join("\n")

  const { onStdout, flush } = createDisplayCallbacks({ projectRoot: process.cwd() })

  let result: ClaudeResult
  try {
    result = await invokeClaude({
      systemPrompt,
      userPrompt,
      model: config.model,
      allowedTools: ["Read", "Write"],
      cwd: process.cwd(),
      timeoutMs: config.timeoutMinutes * 60 * 1000,
      onStdout,
      onStderr: createStderrHandler("refiner"),
    })
  } finally {
    flush()
  }

  // Verify spec.md was rewritten
  if (!fs.existsSync(path.join(config.buildDir, "spec.md"))) {
    throw new Error("Refiner did not write spec.md")
  }

  // Verify spec.changelog.md was written
  if (!fs.existsSync(path.join(config.buildDir, "spec.changelog.md"))) {
    throw new Error("Refiner did not write spec.changelog.md")
  }

  return result
}
