/**
 * Builder continuation markers.
 *
 * The builder's last non-blank line indicates whether the phase is finished
 * (`READY_FOR_REVIEW`) or needs another fresh-context invocation
 * (`MORE_WORK_NEEDED: <reason>`). Anything else is treated as an *implicit*
 * `more_work_needed` so the loop keeps going rather than declaring success.
 */

export type BuilderMarker =
  | { kind: "ready_for_review" }
  | { kind: "more_work_needed"; reason: string; explicit: boolean }

const READY_RE = /^\s*READY_FOR_REVIEW\s*$/
const MORE_WORK_RE = /^\s*MORE_WORK_NEEDED\s*:\s*(.*?)\s*$/

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g

/**
 * Strip ANSI codes and any surrounding markdown code fences, then return
 * the result split into trimmed non-blank lines.
 */
const normalizeLines = (text: string): string[] => {
  const stripped = text.replace(ANSI_RE, "")
  return stripped
    .split(/\r?\n/)
    .map((line) => line.replace(/^`+|`+$/g, "").trimEnd())
    .filter((line) => line.trim().length > 0)
}

/**
 * Scan from the END of the result for the last marker line. Last marker wins
 * if both somehow appear (e.g. the builder included an example marker mid-output).
 */
export const parseBuilderMarker = (resultText: string): BuilderMarker => {
  const lines = normalizeLines(resultText)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (READY_RE.test(line)) return { kind: "ready_for_review" }
    const moreMatch = line.match(MORE_WORK_RE)
    if (moreMatch) {
      const reason = moreMatch[1].trim() || "no reason given"
      return { kind: "more_work_needed", reason, explicit: true }
    }
  }
  return {
    kind: "more_work_needed",
    reason: "no marker emitted",
    explicit: false,
  }
}
