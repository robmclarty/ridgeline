import * as readline from "node:readline"
import { bold, dimInfo, hint } from "./color"

export type PhaseApprovalDecision = "continue" | "stop"

export interface PhaseApprovalContext {
  /** Phase that just completed (one-indexed). */
  completedIndex: number
  /** Total phase count. */
  totalPhases: number
  /** Phase that just completed — id displayed in the prompt. */
  completedPhaseId: string
  /** Next phase id (or `"end"` when this was the last phase). */
  nextPhaseId: string | "end"
}

export interface PhaseApprovalOptions extends PhaseApprovalContext {
  isTTY: boolean
  /** Auto-respond when not a TTY. Default `"continue"` so CI builds don't hang. */
  nonTTYDecision?: PhaseApprovalDecision
  stream?: NodeJS.WritableStream
  input?: NodeJS.ReadableStream
}

const renderPrompt = (ctx: PhaseApprovalContext): string => {
  const stream: "stdout" = "stdout"
  const completedLabel = `${ctx.completedIndex}/${ctx.totalPhases}`
  const nextLabel =
    ctx.nextPhaseId === "end"
      ? "no further phases"
      : `phase ${ctx.completedIndex + 1}/${ctx.totalPhases}: ${ctx.nextPhaseId}`
  return [
    bold("Phase complete", { stream }),
    "   ",
    hint(`${completedLabel}: ${ctx.completedPhaseId}`, { stream }),
    "\n",
    "  ",
    dimInfo("→", { stream }),
    "  ",
    hint(`Continue to ${nextLabel}? `, { stream }),
    "[Y/n/q] ",
  ].join("")
}

const readLine = (input: NodeJS.ReadableStream): Promise<string> =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input, terminal: false })
    let resolved = false
    const settle = (line: string): void => {
      if (resolved) return
      resolved = true
      rl.close()
      resolve(line)
    }
    rl.once("line", (line) => settle(line))
    rl.once("close", () => settle(""))
  })

const parseAnswer = (raw: string): PhaseApprovalDecision => {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed === "n" || trimmed === "no" || trimmed === "q" || trimmed === "quit") {
    return "stop"
  }
  return "continue"
}

/**
 * Pause between phases when `--require-phase-approval` is set. Returns
 * the user's decision: `continue` proceeds, `stop` exits cleanly so the
 * build can be resumed with `ridgeline build <name>`.
 *
 * In non-TTY environments (CI, piped) the function auto-resolves to
 * `nonTTYDecision` (default `continue`) and writes a single notice line.
 */
export const runPhaseApproval = async (
  opts: PhaseApprovalOptions,
): Promise<PhaseApprovalDecision> => {
  const stream = opts.stream ?? process.stdout
  stream.write(renderPrompt(opts))

  if (!opts.isTTY) {
    const decision = opts.nonTTYDecision ?? "continue"
    stream.write(`(non-TTY: auto-${decision})\n`)
    return decision
  }

  const input = opts.input ?? process.stdin
  const answer = await readLine(input)
  stream.write("\n")
  return parseAnswer(answer)
}
