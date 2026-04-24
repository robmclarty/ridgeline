import { createStreamHandler } from "./stream.parse"
import { startSpinner } from "../../ui/spinner"
import { appendTranscript } from "../../ui/transcript"
import { hint } from "../../ui/color"

interface DisplayCallbackOptions {
  /** Suppress fenced JSON blocks (```json ... ```) from display output. */
  suppressJsonBlock?: boolean
  /** When set, strip this prefix from tool-call file paths so the display shows relative paths. */
  projectRoot?: string
  /** When set, render streamed text dimmed. */
  dimText?: boolean
}

const RESUME_DEBOUNCE_MS = 200

/**
 * Create an onStdout callback that streams assistant text to stdout.
 * The spinner pauses while text is streaming and resumes after a
 * debounce period of inactivity, keeping it visible during tool-use pauses.
 * Returns the callback and a flush function to finalize output.
 */
export const createDisplayCallbacks = (opts?: DisplayCallbackOptions): {
  onStdout: (chunk: string) => void
  flush: () => void
} => {
  let hasStreamedText = false
  let lastCharWasNewline = true
  let jsonSuppressed = false
  let lastEventWasTool = false
  let resumeTimer: ReturnType<typeof setTimeout> | null = null
  const spinner = startSpinner()

  const scheduleResume = () => {
    if (resumeTimer) clearTimeout(resumeTimer)
    resumeTimer = setTimeout(() => {
      resumeTimer = null
      if (!lastCharWasNewline) {
        process.stdout.write("\n")
        lastCharWasNewline = true
      }
      spinner.resume()
    }, RESUME_DEBOUNCE_MS)
  }

  const writeText = (text: string) => {
    if (opts?.suppressJsonBlock) {
      const lines = text.split("\n")
      const output: string[] = []
      for (const line of lines) {
        if (!jsonSuppressed && /^\s*```json\s*$/.test(line)) {
          jsonSuppressed = true
          continue
        }
        if (jsonSuppressed) continue
        output.push(line)
      }
      if (output.length === 0) return
      text = output.join("\n")
      if (text.length === 0) return
    }

    if (!lastCharWasNewline) {
      process.stdout.write("\n")
    }
    process.stdout.write(opts?.dimText ? hint(text, { force: true }) : text)
    appendTranscript(text)
    lastCharWasNewline = text.endsWith("\n")
  }

  const handler = createStreamHandler((event) => {
    if (event.type === "text") {
      if (!hasStreamedText) {
        hasStreamedText = true
      }
      spinner.pause()
      if (resumeTimer) clearTimeout(resumeTimer)
      if (lastEventWasTool) {
        process.stdout.write("\n")
        lastEventWasTool = false
      }
      writeText(event.text)
      scheduleResume()
    } else if (event.type === "tool_use") {
      let summary = event.summary
      if (summary && opts?.projectRoot) {
        const root = opts.projectRoot.endsWith("/") ? opts.projectRoot : opts.projectRoot + "/"
        summary = summary.replaceAll(root, "")
      }
      const line = summary
        ? `[${event.tool}] ${summary}`
        : `[${event.tool}]`
      spinner.printAbove(line)
      appendTranscript(line)
      lastEventWasTool = true
    }
  })
  return {
    onStdout: handler,
    flush: () => {
      if (resumeTimer) {
        clearTimeout(resumeTimer)
        resumeTimer = null
      }
      spinner.stop()
      if (hasStreamedText && !lastCharWasNewline) {
        process.stdout.write("\n")
      }
    },
  }
}
