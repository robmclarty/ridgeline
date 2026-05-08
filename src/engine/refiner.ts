import * as fs from "node:fs"
import * as path from "node:path"
import { ClaudeResult } from "../types.js"
import { runClaudeProcess } from "./claude-process.js"
import { createLegacyStdoutDisplay } from "../ui/claude-stream-display.js"
import { buildAgentRegistry } from "./discovery/agent.registry.js"
import { createStderrHandler } from "./legacy-shared.js"
import { SYNTHESIZER_STALL_TIMEOUT_MS } from "./ensemble.js"
import { createPromptDocument } from "./prompt-document.js"

// ---------------------------------------------------------------------------
// Refine executor
// ---------------------------------------------------------------------------

export type RefineConfig = {
  model: string
  timeoutMinutes: number
  buildDir: string
  changelogMd: string | null
  iterationNumber: number
}

export const runRefiner = async (
  specMd: string,
  researchMd: string,
  constraintsMd: string,
  tasteMd: string | null,
  config: RefineConfig,
): Promise<ClaudeResult> => {
  const registry = buildAgentRegistry()
  const systemPrompt = registry.getCorePrompt("refiner.md")

  const doc = createPromptDocument()

  doc.data("spec.md", specMd)
  doc.data("research.md", researchMd)

  if (config.changelogMd) {
    doc.data("spec.changelog.md (your prior changes)", config.changelogMd)
  }

  doc.data("constraints.md", constraintsMd)
  if (tasteMd) {
    doc.data("taste.md", tasteMd)
  }

  doc.instruction(
    "Output",
    `1. Rewrite the spec incorporating research findings. Write the revised spec to: ${config.buildDir}/spec.md\n` +
    `2. Document your changes. Write the changelog to: ${config.buildDir}/spec.changelog.md\n` +
    `   - ${config.changelogMd ? "Read the existing spec.changelog.md first, then prepend" : "Create"} a new ## Iteration ${config.iterationNumber} section.\n` +
    "Use the Write tool for both files.",
  )

  const userPrompt = doc.render()

  const { onStdout, flush } = createLegacyStdoutDisplay({ projectRoot: process.cwd() })

  let result: ClaudeResult
  try {
    result = await runClaudeProcess({
      systemPrompt,
      userPrompt,
      model: config.model,
      allowedTools: ["Read", "Write"],
      cwd: process.cwd(),
      timeoutMs: config.timeoutMinutes * 60 * 1000,
      stallTimeoutMs: SYNTHESIZER_STALL_TIMEOUT_MS,
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
