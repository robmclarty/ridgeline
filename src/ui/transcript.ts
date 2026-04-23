import * as fs from "node:fs"
import * as path from "node:path"
import { stripAnsi } from "./color"

let transcriptFilePath: string | null = null
let isEnabled = true

/** Initialize the plain-text transcript. Call once when buildDir is known. */
export const initTranscript = (buildDir: string): void => {
  transcriptFilePath = path.join(buildDir, "transcript.log")
}

/** Disable transcript capture. */
export const disableTranscript = (): void => {
  isEnabled = false
}

/**
 * Append a line (or chunk) to the on-disk transcript. No-op if not initialized
 * or disabled. ANSI escape sequences are stripped so the file stays readable.
 * A trailing newline is added when `text` does not already end with one.
 */
export const appendTranscript = (text: string): void => {
  if (!isEnabled || !transcriptFilePath) return
  const stripped = stripAnsi(text)
  const withNewline = stripped.endsWith("\n") ? stripped : stripped + "\n"
  try {
    fs.appendFileSync(transcriptFilePath, withNewline)
  } catch {
    // Best-effort: don't crash if transcript can't be written
  }
}
