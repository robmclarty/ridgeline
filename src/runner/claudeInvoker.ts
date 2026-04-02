import { spawn, ChildProcess } from "node:child_process"
import { ClaudeResult } from "../types"

export type InvokeOptions = {
  systemPrompt: string
  userPrompt: string
  model: string
  allowedTools?: string[]
  cwd: string
  verbose: boolean
  timeoutMs?: number
}

// Parse the JSON envelope from claude --output-format json
const parseClaudeJson = (stdout: string): ClaudeResult => {
  const parsed = JSON.parse(stdout)
  return {
    success: !parsed.is_error,
    result: typeof parsed.result === "string" ? parsed.result : (parsed.result != null ? JSON.stringify(parsed.result) : ""),
    durationMs: parsed.duration_ms ?? 0,
    costUsd: parsed.total_cost_usd ?? 0,
    usage: {
      inputTokens: parsed.usage?.input_tokens ?? 0,
      outputTokens: parsed.usage?.output_tokens ?? 0,
      cacheReadInputTokens: parsed.usage?.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: parsed.usage?.cache_creation_input_tokens ?? 0,
    },
    sessionId: parsed.session_id ?? "",
  }
}

// Stream text events from claude --output-format stream-json
const handleStreamLine = (line: string): void => {
  if (!line.trim()) return
  try {
    const event = JSON.parse(line)
    if (event.type === "assistant" && event.subtype === "text") {
      process.stderr.write(event.text)
    }
  } catch {
    // Not valid JSON, skip
  }
}

export const invokeClaude = (opts: InvokeOptions): Promise<ClaudeResult> => {
  return new Promise((resolve, reject) => {
    const args: string[] = [
      "-p",
      "--output-format", opts.verbose ? "stream-json" : "json",
      "--model", opts.model,
      "--verbose",
    ]

    if (opts.allowedTools && opts.allowedTools.length > 0) {
      args.push("--allowedTools", opts.allowedTools.join(","))
    }

    // System prompt passed via --system-prompt flag
    args.push("--system-prompt", opts.systemPrompt)

    const proc: ChildProcess = spawn("claude", args, {
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    })

    let stdoutData = ""
    let stderrData = ""

    // For stream-json mode, we need to handle line-by-line streaming
    let streamBuffer = ""

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8")
      stdoutData += text
      if (opts.verbose) {
        streamBuffer += text
        const lines = streamBuffer.split("\n")
        // Keep the last incomplete line in the buffer
        streamBuffer = lines.pop() ?? ""
        for (const line of lines) {
          handleStreamLine(line)
        }
      }
    })

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrData += chunk.toString("utf-8")
    })

    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | null = null

    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true
        proc.kill("SIGTERM")
        setTimeout(() => proc.kill("SIGKILL"), 5000)
      }, opts.timeoutMs)
    }

    proc.on("close", (code) => {
      if (timer) clearTimeout(timer)

      // Flush remaining stream buffer
      if (opts.verbose && streamBuffer.trim()) {
        handleStreamLine(streamBuffer)
      }

      if (timedOut) {
        reject(new Error("Claude invocation timed out"))
        return
      }

      if (code !== 0 && !stdoutData.trim()) {
        reject(new Error(`claude exited with code ${code}: ${stderrData}`))
        return
      }

      try {
        if (opts.verbose) {
          // In stream-json mode, find the line with type "result"
          // (it's not always the last line — Claude CLI may emit trailing events)
          const lines = stdoutData.trim().split("\n")
          let resultLine: string | undefined
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const parsed = JSON.parse(lines[i])
              if (parsed.type === "result") {
                resultLine = lines[i]
                break
              }
            } catch {
              // Not valid JSON, skip
            }
          }
          if (!resultLine) {
            reject(new Error("No result event found in stream-json output"))
            return
          }
          resolve(parseClaudeJson(resultLine))
        } else {
          resolve(parseClaudeJson(stdoutData))
        }
      } catch (err) {
        reject(new Error(`Failed to parse claude output: ${err}`))
      }
    })

    // Pipe user prompt via stdin
    proc.stdin?.write(opts.userPrompt)
    proc.stdin?.end()
  })
}
