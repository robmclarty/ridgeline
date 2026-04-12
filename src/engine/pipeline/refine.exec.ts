import * as fs from "node:fs"
import * as path from "node:path"
import { ClaudeResult } from "../../types"
import { invokeClaude } from "../claude/claude.exec"
import { createDisplayCallbacks } from "../claude/stream.display"
import { buildAgentRegistry } from "../discovery/agent.registry"
import { resolveFlavour } from "../discovery/flavour.resolve"
import { createStderrHandler } from "./pipeline.shared"
import { SYNTHESIZER_STALL_TIMEOUT_MS } from "./ensemble.exec"
import { PromptDocument } from "./prompt.document"

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

  const doc = new PromptDocument()

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
