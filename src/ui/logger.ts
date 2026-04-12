import * as fs from "node:fs"
import * as path from "node:path"

export type LogLevel = "debug" | "info" | "warn" | "error"

type LogEntry = {
  timestamp: string
  level: LogLevel
  phase: string | null
  message: string
  data?: Record<string, unknown>
}

let logFilePath: string | null = null
let isEnabled = true

/** Initialize the structured logger. Call once when buildDir is known. */
export const initLogger = (buildDir: string): void => {
  logFilePath = path.join(buildDir, "log.jsonl")
}

/** Disable structured logging (e.g., via --no-structured-log). */
export const disableLogger = (): void => {
  isEnabled = false
}

/** Append a structured log entry. No-op if logger is not initialized or disabled. */
export const log = (
  level: LogLevel,
  message: string,
  opts?: { phase?: string; data?: Record<string, unknown> },
): void => {
  if (!isEnabled || !logFilePath) return

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    phase: opts?.phase ?? null,
    message,
  }
  if (opts?.data) entry.data = opts.data

  try {
    fs.appendFileSync(logFilePath, JSON.stringify(entry) + "\n")
  } catch {
    // Best-effort: don't crash if log file can't be written
  }
}
