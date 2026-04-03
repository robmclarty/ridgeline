import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup"

vi.mock("../../engine/claude/claude.exec", () => ({
  invokeClaude: vi.fn(),
}))

vi.mock("../../ui/output", () => ({
  printInfo: vi.fn(),
  printError: vi.fn(),
}))

vi.mock("node:readline", () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((_prompt: string, cb: (answer: string) => void) => {
      cb("Build a CLI tool")
    }),
    close: vi.fn(),
  })),
}))

import { invokeClaude } from "../../engine/claude/claude.exec"
import { runSpec } from "../spec"

const makeClaudeResult = (result: string, sessionId = "sess-1") => ({
  success: true,
  result,
  durationMs: 1000,
  costUsd: 0.01,
  usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  sessionId,
})

const defaultOpts = { model: "opus", timeout: 10 }

describe("commands/spec", () => {
  let origCwd: string
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    origCwd = process.cwd()
    tmpDir = makeTempDir()
    process.chdir(tmpDir)
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("creates build directory structure", async () => {
    // First call: intake turn (returns ready)
    // Second call: generation turn
    vi.mocked(invokeClaude)
      .mockResolvedValueOnce(makeClaudeResult(JSON.stringify({ ready: true, summary: "A CLI tool" })))
      .mockResolvedValueOnce(makeClaudeResult("done"))

    // Create spec.md so verification passes
    const buildDir = path.join(tmpDir, ".ridgeline", "builds", "my-build")
    // runSpec creates the directory, but we need to pre-create the file after the dir exists
    // Use a side-effect on the second invokeClaude call to simulate file creation
    vi.mocked(invokeClaude).mockImplementation(async (opts) => {
      if (opts.allowedTools?.includes("Write")) {
        fs.writeFileSync(path.join(buildDir, "spec.md"), "# Spec")
        fs.writeFileSync(path.join(buildDir, "constraints.md"), "# Constraints")
      }
      return makeClaudeResult(JSON.stringify({ ready: true, summary: "A CLI tool" }))
    })

    await runSpec("my-build", defaultOpts)

    const phasesDir = path.join(tmpDir, ".ridgeline", "builds", "my-build", "phases")
    expect(fs.existsSync(phasesDir)).toBe(true)
  })

  it("invokes claude with json schema for clarification and tools for generation", async () => {
    const buildDir = path.join(tmpDir, ".ridgeline", "builds", "my-build")

    vi.mocked(invokeClaude).mockImplementation(async (opts) => {
      if (opts.allowedTools?.includes("Write")) {
        fs.mkdirSync(buildDir, { recursive: true })
        fs.writeFileSync(path.join(buildDir, "spec.md"), "# Spec")
        fs.writeFileSync(path.join(buildDir, "constraints.md"), "# Constraints")
      }
      return makeClaudeResult(JSON.stringify({ ready: true, summary: "A CLI tool" }))
    })

    await runSpec("my-build", defaultOpts)

    // First call: intake with jsonSchema
    expect(invokeClaude).toHaveBeenCalledTimes(2)
    const firstCall = vi.mocked(invokeClaude).mock.calls[0][0]
    expect(firstCall.jsonSchema).toBeDefined()
    expect(firstCall.model).toBe("opus")

    // Second call: generation with tools
    const secondCall = vi.mocked(invokeClaude).mock.calls[1][0]
    expect(secondCall.allowedTools).toContain("Write")
  })

  it("runs clarification loop when claude asks questions", async () => {
    const buildDir = path.join(tmpDir, ".ridgeline", "builds", "my-build")

    vi.mocked(invokeClaude)
      // Intake: not ready, has questions
      .mockResolvedValueOnce(makeClaudeResult(
        JSON.stringify({ ready: false, questions: ["What language?"], summary: "Need more info" }),
        "sess-1"
      ))
      // Clarification: now ready
      .mockResolvedValueOnce(makeClaudeResult(
        JSON.stringify({ ready: true, summary: "A TypeScript CLI tool" }),
        "sess-1"
      ))
      // Generation
      .mockImplementationOnce(async () => {
        fs.mkdirSync(buildDir, { recursive: true })
        fs.writeFileSync(path.join(buildDir, "spec.md"), "# Spec")
        fs.writeFileSync(path.join(buildDir, "constraints.md"), "# Constraints")
        return makeClaudeResult("done", "sess-1")
      })

    await runSpec("my-build", defaultOpts)

    // 3 calls: intake, clarification, generation
    expect(invokeClaude).toHaveBeenCalledTimes(3)

    // Clarification call should resume the session
    const clarificationCall = vi.mocked(invokeClaude).mock.calls[1][0]
    expect(clarificationCall.sessionId).toBe("sess-1")
  })
})
