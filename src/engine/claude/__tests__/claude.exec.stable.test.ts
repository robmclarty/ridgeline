import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("node:child_process", () => {
  const EventEmitter = require("node:events")
  const createMockProc = (): unknown => {
    const proc = new EventEmitter()
    ;(proc as { stdin: unknown }).stdin = { write: vi.fn(), end: vi.fn() }
    ;(proc as { stdout: unknown }).stdout = new EventEmitter()
    ;(proc as { stderr: unknown }).stderr = new EventEmitter()
    ;(proc as { kill: unknown }).kill = vi.fn()
    ;(proc as { pid: unknown }).pid = 12345
    return proc
  }
  return { spawn: vi.fn(() => createMockProc()) }
})

import { spawn } from "node:child_process"
import { assertSystemPromptFlagsExclusive, invokeClaude } from "../claude.exec"
import { __resetStablePromptState } from "../stable.prompt"

const sampleResult = JSON.stringify({
  type: "result",
  is_error: false,
  result: "ok",
  duration_ms: 1,
  total_cost_usd: 0,
  usage: {
    input_tokens: 1,
    output_tokens: 1,
    cache_read_input_tokens: 7,
    cache_creation_input_tokens: 3,
  },
  session_id: "s1",
})

const STABLE_BLOCK = "## constraints.md\n\nhello\n\n## spec.md\n\nworld\n"

const makeTempBuildDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-stable-test-"))
  return dir
}

const finishSpawn = (): void => {
  const proc = vi.mocked(spawn).mock.results[0].value as {
    stdout: { emit: (event: string, chunk: Buffer) => void }
    emit: (event: string, code: number) => void
  }
  proc.stdout.emit("data", Buffer.from(sampleResult + "\n"))
  proc.emit("close", 0)
}

describe("invokeClaude stable-prompt wiring", () => {
  let buildDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    __resetStablePromptState()
    buildDir = makeTempBuildDir()
  })

  afterEach(() => {
    fs.rmSync(buildDir, { recursive: true, force: true })
  })

  it("passes --append-system-prompt-file and --exclude-dynamic-system-prompt-sections when flag is available", async () => {
    const promise = invokeClaude({
      systemPrompt: "sys",
      userPrompt: "user",
      model: "opus",
      cwd: "/tmp",
      stablePrompt: STABLE_BLOCK,
      buildDir,
      helpRunner: () => "--exclude-dynamic-system-prompt-sections",
    })
    finishSpawn()
    await promise

    const argv = vi.mocked(spawn).mock.calls[0][1] as string[]
    const fileFlagIdx = argv.indexOf("--append-system-prompt-file")
    expect(fileFlagIdx).toBeGreaterThan(-1)
    const filePath = argv[fileFlagIdx + 1]
    expect(filePath.startsWith(os.tmpdir())).toBe(true)
    expect(fs.existsSync(filePath)).toBe(true)
    expect(fs.readFileSync(filePath, "utf-8")).toBe(`${STABLE_BLOCK}\nsys`)
    expect(argv).toContain("--exclude-dynamic-system-prompt-sections")
    // The CLI rejects passing both --append-system-prompt and
    // --append-system-prompt-file together; caching path must use only the file.
    expect(argv).not.toContain("--append-system-prompt")
  })

  it("falls back to --append-system-prompt with the dynamic prompt when caching is unavailable", async () => {
    const promise = invokeClaude({
      systemPrompt: "sys",
      userPrompt: "user",
      model: "opus",
      cwd: "/tmp",
      stablePrompt: STABLE_BLOCK,
      buildDir,
      helpRunner: () => "--model\n--verbose\n",
    })
    finishSpawn()
    await promise

    const argv = vi.mocked(spawn).mock.calls[0][1] as string[]
    const idx = argv.indexOf("--append-system-prompt")
    expect(idx).toBeGreaterThan(-1)
    expect(argv[idx + 1]).toBe("sys")
    expect(argv).not.toContain("--append-system-prompt-file")
  })

  it("omits both flags when the Claude CLI lacks --exclude-dynamic-system-prompt-sections", async () => {
    const promise = invokeClaude({
      systemPrompt: "sys",
      userPrompt: "user",
      model: "opus",
      cwd: "/tmp",
      stablePrompt: STABLE_BLOCK,
      buildDir,
      helpRunner: () => "--model\n--verbose\n",
    })
    finishSpawn()
    await promise

    const argv = vi.mocked(spawn).mock.calls[0][1] as string[]
    expect(argv).not.toContain("--append-system-prompt-file")
    expect(argv).not.toContain("--exclude-dynamic-system-prompt-sections")
  })

  it("logs prompt_stable_hash with the file sha256 to trajectory.jsonl", async () => {
    const promise = invokeClaude({
      systemPrompt: "sys",
      userPrompt: "user",
      model: "opus",
      cwd: "/tmp",
      stablePrompt: STABLE_BLOCK,
      buildDir,
      helpRunner: () => "--exclude-dynamic-system-prompt-sections",
    })
    finishSpawn()
    await promise

    const trajectoryPath = path.join(buildDir, "trajectory.jsonl")
    const entries = fs.readFileSync(trajectoryPath, "utf-8").trim().split("\n").map((l) => JSON.parse(l))
    const hashEvents = entries.filter((e) => e.type === "prompt_stable_hash")
    expect(hashEvents.length).toBe(1)
    expect(hashEvents[0].promptStableHash).toMatch(/^[a-f0-9]{64}$/)
    expect(hashEvents[0].summary).toContain(hashEvents[0].promptStableHash)
    expect(hashEvents[0].reason).toBeUndefined()
  })

  it("logs one cli_flag_unavailable entry when the flag is missing", async () => {
    const promise = invokeClaude({
      systemPrompt: "sys",
      userPrompt: "user",
      model: "opus",
      cwd: "/tmp",
      stablePrompt: STABLE_BLOCK,
      buildDir,
      helpRunner: () => "--model\n--verbose\n",
    })
    finishSpawn()
    await promise

    const trajectoryPath = path.join(buildDir, "trajectory.jsonl")
    const entries = fs.readFileSync(trajectoryPath, "utf-8").trim().split("\n").map((l) => JSON.parse(l))
    const infoEvents = entries.filter((e) => e.type === "prompt_stable_hash")
    expect(infoEvents.length).toBe(1)
    expect(infoEvents[0].reason).toBe("cli_flag_unavailable")
    expect(infoEvents[0].promptStableHash).toBeUndefined()
  })

  it("does not re-log cli_flag_unavailable across multiple invocations in one process", async () => {
    for (let i = 0; i < 3; i++) {
      vi.clearAllMocks()
      const p = invokeClaude({
        systemPrompt: "sys",
        userPrompt: "user",
        model: "opus",
        cwd: "/tmp",
        stablePrompt: STABLE_BLOCK,
        buildDir,
        helpRunner: () => "no-flag-here",
      })
      finishSpawn()
      await p
    }
    const trajectoryPath = path.join(buildDir, "trajectory.jsonl")
    const entries = fs.readFileSync(trajectoryPath, "utf-8").trim().split("\n").map((l) => JSON.parse(l))
    const unavailable = entries.filter((e) =>
      e.type === "prompt_stable_hash" && e.reason === "cli_flag_unavailable",
    )
    expect(unavailable.length).toBe(1)
  })

  it("skips caching code path when stablePrompt is empty", async () => {
    const promise = invokeClaude({
      systemPrompt: "sys",
      userPrompt: "user",
      model: "opus",
      cwd: "/tmp",
      helpRunner: () => "--exclude-dynamic-system-prompt-sections",
    })
    finishSpawn()
    await promise

    const argv = vi.mocked(spawn).mock.calls[0][1] as string[]
    expect(argv).not.toContain("--append-system-prompt-file")
    expect(argv).not.toContain("--exclude-dynamic-system-prompt-sections")
    const trajectoryPath = path.join(buildDir, "trajectory.jsonl")
    expect(fs.existsSync(trajectoryPath)).toBe(false)
  })
})

describe("assertSystemPromptFlagsExclusive", () => {
  it("throws when both system-prompt append flags are present", () => {
    expect(() => assertSystemPromptFlagsExclusive([
      "--append-system-prompt", "x",
      "--append-system-prompt-file", "/tmp/y.md",
    ])).toThrow(/rejects this combination/)
  })

  it("does not throw when only --append-system-prompt is present", () => {
    expect(() => assertSystemPromptFlagsExclusive([
      "--append-system-prompt", "x",
    ])).not.toThrow()
  })

  it("does not throw when only --append-system-prompt-file is present", () => {
    expect(() => assertSystemPromptFlagsExclusive([
      "--append-system-prompt-file", "/tmp/y.md",
    ])).not.toThrow()
  })

  it("does not throw when neither flag is present", () => {
    expect(() => assertSystemPromptFlagsExclusive(["--model", "opus"])).not.toThrow()
  })
})
