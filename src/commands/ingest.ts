import * as path from "node:path"
import { printInfo, printError } from "../ui/output"
import { resolveInputBundle, ResolvedBundle } from "./input"
import { runShapeOneShot } from "./shape"
import { runSpec, SpecOptions } from "./spec"
import { resolveBuildDir } from "../config"
import { resolveSpecialistTimeoutSeconds } from "../stores/settings"

type IngestOptions = {
  model: string
  timeout: number
  maxBudgetUsd?: number
  specialistCount?: 1 | 2 | 3
  /**
   * Source spec path. May point at a single file (PRD, RFC, design doc) or
   * a directory of related markdown/text files that get concatenated. Raw
   * text is also accepted but rare for ingest (the use case is "I already
   * wrote the spec elsewhere").
   */
  input: string
}

const describeBundle = (bundle: ResolvedBundle): string => {
  switch (bundle.type) {
    case "file":
      return bundle.path
    case "directory":
      return `${bundle.path} (${bundle.files.length} files)`
    case "text":
      return "inline text"
  }
}

/**
 * One-shot ingest: convert a freeform spec (file, directory bundle, or raw
 * text) into the four ridgeline files (shape.md, spec.md, constraints.md,
 * taste.md, plus design.md when visual shapes match) without any Q&A. The
 * synthesizer is asked to flag inferred facts in a `## Inferred / Gaps`
 * section per file so the user can edit those by hand instead of through
 * back-and-forth chat.
 */
export const runIngest = async (
  buildName: string,
  opts: IngestOptions,
): Promise<void> => {
  let bundle: ResolvedBundle
  try {
    bundle = resolveInputBundle(opts.input)
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err))
    return
  }

  const buildDir = resolveBuildDir(buildName, { ensure: true })
  printInfo(`Build: ${buildName}`)
  printInfo(`Source: ${describeBundle(bundle)}`)
  console.log("")

  // --- Shape (one-shot, no Q&A) ---
  // runShapeOneShot auto-chains to runDesignOneShot if visual shapes match.
  await runShapeOneShot(buildName, {
    model: opts.model,
    timeout: opts.timeout,
    inputContent: bundle.content,
    inputLabel: bundle.type === "file"
      ? bundle.path
      : bundle.type === "directory"
        ? `${bundle.path} (${bundle.files.length} files)`
        : "inline text",
  })

  // --- Spec ensemble (already non-interactive) ---
  // Pass the bundle as authoritative userInput and turn on gap flagging so
  // the synthesizer adds `## Inferred / Gaps` to each file.
  const specOpts: SpecOptions = {
    model: opts.model,
    timeout: opts.timeout,
    maxBudgetUsd: opts.maxBudgetUsd,
    specialistCount: opts.specialistCount,
    specialistTimeoutSeconds: resolveSpecialistTimeoutSeconds(
      path.join(process.cwd(), ".ridgeline"),
    ),
    inputContent: bundle.content,
    inferGapFlagging: true,
  }
  await runSpec(buildName, specOpts)

  console.log("")
  printInfo(`Ingest complete for ${buildName}.`)
  printInfo(`Review the generated files in ${buildDir} (especially the "Inferred / Gaps" sections), then run: ridgeline plan ${buildName}`)
}
