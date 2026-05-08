import { describe, it, expect } from "vitest"
import { run } from "fascicle"
import { refineFlow } from "../refine.flow.js"
import type { ClaudeResult } from "../../../types.js"

const cannedResult = (): ClaudeResult => ({
  success: true,
  result: "refined",
  durationMs: 100,
  costUsd: 0.05,
  usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  sessionId: "sess-test",
})

describe("refineFlow", () => {
  it("invokes the injected executor with the flow input", async () => {
    const calls: unknown[] = []
    const flow = refineFlow({
      executor: async (input) => {
        calls.push(input)
        return cannedResult()
      },
    })

    const out = await run(flow, {
      specMd: "spec",
      researchMd: "research",
      constraintsMd: "constraints",
      tasteMd: null,
      model: "opus",
      timeoutMinutes: 10,
      buildDir: "/tmp",
      changelogMd: null,
      iterationNumber: 1,
    }, { install_signal_handlers: false })

    expect(out.result.sessionId).toBe("sess-test")
    expect(calls).toHaveLength(1)
  })

  it("propagates executor errors", async () => {
    const flow = refineFlow({
      executor: async () => {
        throw new Error("boom")
      },
    })

    await expect(run(flow, {
      specMd: "",
      researchMd: "",
      constraintsMd: "",
      tasteMd: null,
      model: "opus",
      timeoutMinutes: 10,
      buildDir: "/tmp",
      changelogMd: null,
      iterationNumber: 1,
    }, { install_signal_handlers: false })).rejects.toThrow("boom")
  })
})
