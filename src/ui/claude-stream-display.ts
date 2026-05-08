import type { StreamChunk } from "fascicle"
import { startSpinner } from "./spinner.js"
import { appendTranscript } from "./transcript.js"
import { hint } from "./color.js"

interface StreamDisplayOptions {
  readonly suppressJsonBlock?: boolean
  readonly projectRoot?: string
  readonly dimText?: boolean
}

const RESUME_DEBOUNCE_MS = 200
const MAX_SUMMARY_LEN = 200

const summarizeToolInput = (input: unknown): string | undefined => {
  if (input === null || typeof input !== "object") return undefined
  const obj = input as Record<string, unknown>
  const raw =
    obj.command ??
    obj.file_path ??
    obj.pattern ??
    obj.prompt
  if (typeof raw !== "string" || raw.length === 0) return undefined
  const firstLine = raw.split("\n")[0]
  return firstLine.length <= MAX_SUMMARY_LEN
    ? firstLine
    : firstLine.slice(0, MAX_SUMMARY_LEN - 1) + "…"
}

export const createStreamDisplay = (opts: StreamDisplayOptions = {}): {
  onChunk: (chunk: StreamChunk) => void
  flush: () => void
} => {
  let hasStreamedText = false
  let lastCharWasNewline = true
  let jsonSuppressed = false
  let lastEventWasTool = false
  let resumeTimer: ReturnType<typeof setTimeout> | null = null
  const toolNames = new Map<string, string>()
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
    if (opts.suppressJsonBlock) {
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
    process.stdout.write(opts.dimText ? hint(text, { force: true }) : text)
    appendTranscript(text)
    lastCharWasNewline = text.endsWith("\n")
  }

  const onChunk = (chunk: StreamChunk): void => {
    if (chunk.kind === "text") {
      if (!hasStreamedText) hasStreamedText = true
      spinner.pause()
      if (resumeTimer) clearTimeout(resumeTimer)
      if (lastEventWasTool) {
        process.stdout.write("\n")
        lastEventWasTool = false
      }
      writeText(chunk.text)
      scheduleResume()
      return
    }
    if (chunk.kind === "tool_call_start") {
      toolNames.set(chunk.id, chunk.name)
      return
    }
    if (chunk.kind === "tool_call_end") {
      const toolName = toolNames.get(chunk.id) ?? "tool"
      toolNames.delete(chunk.id)
      let summary = summarizeToolInput(chunk.input)
      if (summary && opts.projectRoot) {
        const root = opts.projectRoot.endsWith("/") ? opts.projectRoot : opts.projectRoot + "/"
        summary = summary.replaceAll(root, "")
      }
      const line = summary ? `[${toolName}] ${summary}` : `[${toolName}]`
      spinner.printAbove(line)
      appendTranscript(line)
      lastEventWasTool = true
    }
  }

  return {
    onChunk,
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

interface LegacyStreamEvent {
  type: "text" | "tool_use" | "result" | "other"
  text?: string
  tool?: string
  summary?: string
}

const parseLegacyStreamLine = (line: string): LegacyStreamEvent => {
  const trimmed = line.trim()
  if (trimmed.length === 0) return { type: "other" }
  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(trimmed) } catch { return { type: "other" } }

  if (parsed.type === "assistant" && parsed.subtype === "text") {
    const text = parsed.text
    if (typeof text === "string" && text.length > 0) return { type: "text", text }
    return { type: "other" }
  }
  if (parsed.type === "assistant" && parsed.subtype === "tool_use") {
    const tool = parsed.tool
    if (typeof tool === "string" && tool.length > 0) return { type: "tool_use", tool }
    return { type: "other" }
  }
  if (parsed.type === "assistant" && parsed.message) {
    const message = parsed.message as Record<string, unknown>
    const content = message.content as Array<Record<string, unknown>> | undefined
    if (Array.isArray(content)) {
      const textParts = content
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text as string)
        .join("")
      if (textParts.length > 0) return { type: "text", text: textParts }
      const toolBlock = content.find((c) => c.type === "tool_use" && typeof c.name === "string")
      if (toolBlock) {
        const summary = toolBlock.input
          ? summarizeToolInput(toolBlock.input)
          : undefined
        return { type: "tool_use", tool: toolBlock.name as string, summary }
      }
    }
    return { type: "other" }
  }
  if (parsed.type === "result") return { type: "result" }
  return { type: "other" }
}

/**
 * Legacy stream-display adapter for direct-spawn `claude --output-format stream-json`
 * callers (the ones still using `runClaudeProcess` instead of fascicle's `Engine`).
 * Produces a string-chunk `onStdout` callback rather than a fascicle StreamChunk one.
 */
export const createLegacyStdoutDisplay = (opts: StreamDisplayOptions = {}): {
  onStdout: (chunk: string) => void
  flush: () => void
} => {
  let hasStreamedText = false
  let lastCharWasNewline = true
  let jsonSuppressed = false
  let lastEventWasTool = false
  let resumeTimer: ReturnType<typeof setTimeout> | null = null
  const spinner = startSpinner()
  let buffer = ""

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
    if (opts.suppressJsonBlock) {
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
    if (!lastCharWasNewline) process.stdout.write("\n")
    process.stdout.write(opts.dimText ? hint(text, { force: true }) : text)
    appendTranscript(text)
    lastCharWasNewline = text.endsWith("\n")
  }

  const onLine = (line: string) => {
    if (line.trim().length === 0) return
    const event = parseLegacyStreamLine(line)
    if (event.type === "text" && typeof event.text === "string") {
      if (!hasStreamedText) hasStreamedText = true
      spinner.pause()
      if (resumeTimer) clearTimeout(resumeTimer)
      if (lastEventWasTool) {
        process.stdout.write("\n")
        lastEventWasTool = false
      }
      writeText(event.text)
      scheduleResume()
    } else if (event.type === "tool_use" && typeof event.tool === "string") {
      let summary = event.summary
      if (summary && opts.projectRoot) {
        const root = opts.projectRoot.endsWith("/") ? opts.projectRoot : opts.projectRoot + "/"
        summary = summary.replaceAll(root, "")
      }
      const renderedLine = summary ? `[${event.tool}] ${summary}` : `[${event.tool}]`
      spinner.printAbove(renderedLine)
      appendTranscript(renderedLine)
      lastEventWasTool = true
    }
  }

  return {
    onStdout: (chunk: string) => {
      buffer += chunk
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) onLine(line)
    },
    flush: () => {
      if (buffer.length > 0) {
        onLine(buffer)
        buffer = ""
      }
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
