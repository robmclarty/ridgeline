import { describe, it, expect } from "vitest"
import { z } from "zod"
import type { Tool } from "fascicle"
import { runClaudeOneShot } from "../claude.runner.js"
import { stubEngine } from "../atoms/__tests__/_stub.engine.js"

const dummyTool: Tool = {
  name: "Echo",
  description: "echo input",
  input_schema: z.object({ x: z.string() }),
  execute: (input: { x: string }) => input.x,
} as unknown as Tool

describe("runClaudeOneShot — tool bridging", () => {
  it("forwards tools, maxSteps and toolErrorPolicy to engine.generate", async () => {
    const engine = stubEngine()
    await runClaudeOneShot({
      engine,
      model: "openai:gpt-4o",
      system: "s",
      prompt: "p",
      tools: [dummyTool],
      maxSteps: 7,
      toolErrorPolicy: "feed_back",
    })
    const opts = engine.generate.mock.calls[0]![0]
    expect(opts.tools).toEqual([dummyTool])
    expect(opts.max_steps).toBe(7)
    expect(opts.tool_error_policy).toBe("feed_back")
    // No claude_cli provider-options were requested, so none are sent.
    expect(opts.provider_options).toBeUndefined()
  })

  it("omits tools/max_steps and preserves claude_cli provider_options when no tools (byte-stable)", async () => {
    const engine = stubEngine()
    await runClaudeOneShot({
      engine,
      model: "opus",
      system: "s",
      prompt: "p",
      allowedTools: ["Read", "Glob"],
      sessionId: "sess-1",
    })
    const opts = engine.generate.mock.calls[0]![0]
    expect(opts.tools).toBeUndefined()
    expect(opts.max_steps).toBeUndefined()
    expect(opts.tool_error_policy).toBeUndefined()
    expect(opts.provider_options).toEqual({
      claude_cli: { allowed_tools: ["Read", "Glob"], session_id: "sess-1" },
    })
  })
})
