import { describe, it, expect } from "vitest"
import { extractClaudeResultFromNdjson } from "../claude-process.js"

const resultLine = JSON.stringify({
  type: "result",
  is_error: false,
  result: "done",
  duration_ms: 1234,
  total_cost_usd: 0.42,
  usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  session_id: "sess-1",
})

describe("extractClaudeResultFromNdjson — provider/model attribution", () => {
  it("stamps provider=claude_cli and the passed model (the subprocess transport is the CLI by definition)", () => {
    const result = extractClaudeResultFromNdjson(resultLine, "opus")
    expect(result.provider).toBe("claude_cli")
    expect(result.model).toBe("opus")
    expect(result.costUsd).toBe(0.42)
    expect(result.result).toBe("done")
  })

  it("stamps provider=claude_cli with model undefined when no model is passed", () => {
    const result = extractClaudeResultFromNdjson(resultLine)
    expect(result.provider).toBe("claude_cli")
    expect(result.model).toBeUndefined()
  })
})
