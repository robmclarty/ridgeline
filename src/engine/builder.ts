import * as fs from "node:fs"
import * as path from "node:path"
import type { Engine } from "fascicle"
import { RidgelineConfig, PhaseInfo, ClaudeResult } from "../types.js"
import { runClaudeProcess } from "./claude-process.js"
import { runClaudeOneShot } from "./claude.runner.js"
import { createLegacyStdoutDisplay, createStreamDisplay } from "../ui/claude-stream-display.js"
import { readHandoff } from "../stores/handoff.js"
import { cleanupPluginDirs } from "./discovery/plugin.scan.js"
import { buildAgentRegistry } from "./discovery/agent.registry.js"
import { prepareAgentsAndPlugins, appendConstraintsAndTaste, appendDesign, appendAssetCatalog, commonInvokeOptions } from "./legacy-shared.js"
import { createPromptDocument } from "./prompt-document.js"
import { getDiscoveriesPath, readDiscoveries } from "./discoveries.js"
import { buildToolSurface } from "./tools/factory.js"
import { toolContextFromConfig } from "./engine-inputs.js"

/** Tool-loop step cap for an engine builder (many Read/Edit/Bash turns). */
const ENGINE_BUILDER_MAX_STEPS = 80

/**
 * Resolve the file path the builder should append handoff notes to.
 * In the sequential path (cwd unset), this is the canonical handoff.md.
 * In the wave path (cwd is a worktree), this is a per-phase fragment
 * inside the worktree's buildDir, so concurrent phases never collide
 * on the same file at git-merge time. Fragments are stitched back into
 * the canonical handoff.md by consolidateHandoffs after the wave merges.
 */
const resolveHandoffTarget = (config: RidgelineConfig, phase: PhaseInfo, cwd?: string): string => {
  if (!cwd) return path.join(config.buildDir, "handoff.md")
  return path.join(cwd, ".ridgeline", "builds", config.buildName, `handoff-${phase.id}.md`)
}

export const assembleUserPrompt = (
  config: RidgelineConfig,
  phase: PhaseInfo,
  feedbackPath: string | null,
  cwd?: string,
): string => {
  const doc = createPromptDocument()

  appendConstraintsAndTaste(doc, config)
  appendDesign(doc, config)
  appendAssetCatalog(doc, config)

  // Inject learnings from previous builds if available
  const learningsPath = path.join(config.ridgelineDir, "learnings.md")
  if (fs.existsSync(learningsPath)) {
    const learnings = fs.readFileSync(learningsPath, "utf-8").trim()
    if (learnings) {
      doc.data("Learnings from Previous Builds", learnings)
    }
  }

  const handoff = readHandoff(config.buildDir)
  if (handoff) {
    doc.data("handoff.md", handoff)
  }

  doc.data("Phase Spec", fs.readFileSync(phase.filepath, "utf-8"))

  if (config.checkCommand) {
    doc.instruction(
      "Check Command",
      `Run this command after making changes to verify correctness:\n\n\`\`\`\n${config.checkCommand}\n\`\`\``,
    )
  }

  // Handoff file path for the builder to append to. Wave runs use a
  // per-phase fragment so parallel phases don't collide at merge time.
  doc.instruction("Handoff File", `Append your handoff notes to: ${resolveHandoffTarget(config, phase, cwd)}`)

  // Cross-phase discoveries log. Lives at an absolute path in the main
  // worktree so parallel siblings see each other's environmental fixes
  // in real time. Always include the section so the builder knows the
  // path, even when the file is empty.
  appendDiscoveriesSection(doc, config, phase)

  if (feedbackPath && fs.existsSync(feedbackPath)) {
    doc.data(
      "Reviewer Feedback (RETRY)",
      "This is a retry. The reviewer found issues with your previous attempt.\n" +
      "Focus on fixing these issues. Do not redo work that already passed.\n\n" +
      fs.readFileSync(feedbackPath, "utf-8"),
    )
  }

  return doc.render()
}

const appendDiscoveriesSection = (
  doc: ReturnType<typeof createPromptDocument>,
  config: RidgelineConfig,
  phase: PhaseInfo,
): void => {
  const discoveriesPath = getDiscoveriesPath(config.buildDir)
  const existing = readDiscoveries(config.buildDir)
  const recap = existing.length > 0
    ? `Existing entries (${existing.length}):\n\n` +
      existing.map((e) => `- [${e.source}/${e.phase_id}] ${e.solution} — ${e.blocker}`).join("\n")
    : "Log is currently empty."

  doc.instruction(
    "Cross-Phase Discoveries",
    [
      `Path: ${discoveriesPath}`,
      "",
      "This is a shared, append-only JSONL log used by parallel phases to share environmental fixes (missing binaries, sandbox-blocked downloads, permission workarounds). Entries are advisory — verify before applying.",
      "",
      "Behaviour:",
      `- BEFORE working around an environmental blocker (a tool/binary missing, a network call refused, a permission denied), read this file. A sibling phase may have already solved the same problem; if so, verify the fix applies in your worktree before reapplying.`,
      `- AFTER you find a working remediation for an environmental blocker, append a one-line JSON entry: \`{"ts":"<ISO>","phase_id":"${phase.id}","blocker":"<one line>","solution":"<one line>","source":"agent"}\`. Use \`>> ${discoveriesPath}\` so the append is atomic. Optional \`evidence\` field can point at a check summary or file.`,
      `- Do NOT log code-level decisions, deliverable choices, or notes for the next builder — those go in handoff.md / the builder progress file. Only environmental gotchas belong here.`,
      "",
      recap,
    ].join("\n"),
  )
}

/**
 * Optional extras the builder loop appends to the user prompt. Tests that
 * mock `runBuilder` ignore these without ceremony — they're additive.
 */
export interface BuilderInvocationExtras {
  /** Budget instruction block telling the builder its soft/hard targets. */
  budgetInstruction?: string
  /** Continuation preamble (only present on attempt > 1). */
  continuationPreamble?: string
  /** Path to the per-phase builder progress file the builder appends to. */
  progressFilePath?: string
}

export const runBuilder = async (
  config: RidgelineConfig,
  phase: PhaseInfo,
  feedbackPath: string | null,
  cwd?: string,
  extras?: BuilderInvocationExtras,
): Promise<ClaudeResult> => {
  const registry = buildAgentRegistry()
  const systemPrompt = registry.getCorePrompt("builder.md")
  const baseUserPrompt = assembleUserPrompt(config, phase, feedbackPath, cwd)
  const userPrompt = appendBuilderExtras(baseUserPrompt, extras)
  const { onStdout, flush } = createLegacyStdoutDisplay({ projectRoot: cwd ?? process.cwd() })
  const prepared = prepareAgentsAndPlugins(config)

  try {
    const result = await runClaudeProcess({
      systemPrompt,
      userPrompt,
      model: config.model,
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Agent", "Skill"],
      ...commonInvokeOptions(config, prepared, onStdout, cwd),
    })

    return result
  } finally {
    flush()
    cleanupPluginDirs(prepared.pluginDirs)
  }
}

/**
 * Engine-path builder (AI-SDK providers). Builds the SAME prompt as the spawn
 * `runBuilder` (`assembleUserPrompt` + `appendBuilderExtras`) and runs it through
 * fascicle's in-process tool loop with the full builder tool surface. Continuation
 * state, budget, and halt logic stay in `runBuilderLoop` — this is just the leaf.
 */
export const runBuilderViaEngine = async (
  config: RidgelineConfig,
  phase: PhaseInfo,
  feedbackPath: string | null,
  cwd: string | undefined,
  extras: BuilderInvocationExtras | undefined,
  engine: Engine,
): Promise<ClaudeResult> => {
  const registry = buildAgentRegistry()
  const systemPrompt = registry.getCorePrompt("builder.md")
  const userPrompt = appendBuilderExtras(assembleUserPrompt(config, phase, feedbackPath, cwd), extras)
  const tools = buildToolSurface("builder", toolContextFromConfig(config, cwd))
  const { onChunk, flush } = createStreamDisplay({ projectRoot: cwd ?? process.cwd() })

  // Own the timeout so an elapsed deadline surfaces the marker the builder loop
  // classifies as a (retryable) timeout rather than a hard error.
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, config.timeoutMinutes * 60 * 1000)
  const wallStart = Date.now()
  try {
    const result = await runClaudeOneShot({
      engine,
      model: config.model,
      system: systemPrompt,
      prompt: userPrompt,
      tools,
      maxSteps: ENGINE_BUILDER_MAX_STEPS,
      toolErrorPolicy: "feed_back",
      onChunk,
      abort: controller.signal,
    })
    if (result.durationMs === 0) result.durationMs = Date.now() - wallStart
    return result
  } catch (err) {
    if (timedOut) throw new Error("Claude invocation timed out")
    throw err
  } finally {
    clearTimeout(timer)
    flush()
  }
}

const appendBuilderExtras = (basePrompt: string, extras?: BuilderInvocationExtras): string => {
  if (!extras) return basePrompt
  const sections: string[] = [basePrompt]
  if (extras.continuationPreamble) sections.push(extras.continuationPreamble)
  if (extras.budgetInstruction) {
    sections.push("## Builder Budget", extras.budgetInstruction)
  }
  if (extras.progressFilePath) {
    sections.push(
      "## Builder Progress File",
      `Append continuation entries to: ${extras.progressFilePath}`,
    )
  }
  return sections.join("\n\n")
}
