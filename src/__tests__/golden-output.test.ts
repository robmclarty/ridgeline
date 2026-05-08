import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { printError, printInfo, printPhase, printPhaseHeader } from "../ui/output.js"
import { stripAnsi } from "../ui/color.js"
import { disableTranscript } from "../ui/transcript.js"

const SNAPSHOT_DIR = path.resolve(
  ".ridgeline/builds/fascicle-migration/baseline/output-snapshots",
)

const SHOULD_UPDATE = process.env.UPDATE_GOLDEN_OUTPUT === "1"

const TIMESTAMP_RE = /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/g
const RUN_ID_RE = /<run-[0-9a-f]{8,}>/g
const BUILD_PATH_RE = /\.ridgeline\/builds\/[a-zA-Z0-9._-]+\//g
const CSI_ERASE_LINE_RE = /\[\d*K/g
const CARRIAGE_RETURN_RE = /\r(?!\n)/g

const normalize = (text: string): string => {
  let out = stripAnsi(text)
  out = out.replace(TIMESTAMP_RE, "[<TS>]")
  out = out.replace(RUN_ID_RE, "<RUN-ID>")
  out = out.replace(BUILD_PATH_RE, ".ridgeline/builds/<BUILD>/")
  out = out.replace(CSI_ERASE_LINE_RE, "")
  out = out.replace(CARRIAGE_RETURN_RE, "")
  return out
}

type Capture = { readonly stdout: string; readonly stderr: string }

const captureOutput = (run: () => void | Promise<void>): Promise<Capture> => {
  const stdoutChunks: string[] = []
  const stderrChunks: string[] = []
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    stdoutChunks.push(args.map((a) => String(a)).join(" ") + "\n")
  })
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    stderrChunks.push(args.map((a) => String(a)).join(" ") + "\n")
  })
  return Promise.resolve(run()).finally(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  }).then(() => ({
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
  }))
}

const assertOrUpdate = (name: string, stream: "stdout" | "stderr", actual: string): void => {
  const file = path.join(SNAPSHOT_DIR, `${name}.${stream}.txt`)
  if (SHOULD_UPDATE) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true })
    fs.writeFileSync(file, actual)
    return
  }
  const expected = fs.readFileSync(file, "utf8")
  expect(actual).toBe(expected)
}

const recoveryBlock = (phaseId: string, checkpointTag: string, phaseFilepath: string, buildName: string): void => {
  printInfo(`Recovery: git reset --hard ${checkpointTag}`)
  printInfo("Options:")
  printInfo(`  1. Edit spec.md and re-run: ridgeline plan ${buildName} && ridgeline build ${buildName}`)
  printInfo(`  2. Edit the phase spec directly: ${phaseFilepath}`)
  printInfo(`  3. Resume after manual fixes: ridgeline build ${buildName}`)
}

let prevNoColor: string | undefined

beforeAll(() => {
  prevNoColor = process.env.NO_COLOR
  process.env.NO_COLOR = "1"
  disableTranscript()
})

afterAll(() => {
  if (prevNoColor === undefined) delete process.env.NO_COLOR
  else process.env.NO_COLOR = prevNoColor
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-05-07T12:00:00.000Z"))
})

afterEach(() => {
  vi.useRealTimers()
})

describe("golden-file output snapshots", () => {
  it("(a) successful build: phase header + per-phase status + final summary", async () => {
    const cap = await captureOutput(() => {
      printPhaseHeader(1, 2, "01-scaffold")
      printPhase("01-scaffold", "PASS")
      printPhaseHeader(2, 2, "02-core")
      printPhase("02-core", "PASS")
      printInfo("Build complete: 2/2 phase(s) passed, $0.42 spent.")
    })
    assertOrUpdate("successful-build", "stdout", normalize(cap.stdout))
    assertOrUpdate("successful-build", "stderr", normalize(cap.stderr))
  })

  it("(b) SIGINT mid-build: cleanup announcement and exit message", async () => {
    const cap = await captureOutput(() => {
      printPhaseHeader(1, 2, "01-scaffold")
      printPhase("01-scaffold", "Building...")
      printInfo("Interrupted by SIGINT — cleaning up.")
      printInfo("Worktree removed.")
    })
    assertOrUpdate("sigint-mid-build", "stdout", normalize(cap.stdout))
    assertOrUpdate("sigint-mid-build", "stderr", normalize(cap.stderr))
  })

  it("(c) adversarial round-cap retry exhausted", async () => {
    const cap = await captureOutput(() => {
      printPhaseHeader(1, 1, "01-scaffold")
      printPhase("01-scaffold", "FAILED: retries exhausted")
      recoveryBlock(
        "01-scaffold",
        "ridgeline/checkpoint/<BUILD>/01-scaffold",
        ".ridgeline/builds/<BUILD>/phases/01-scaffold.md",
        "<BUILD>",
      )
    })
    assertOrUpdate("adversarial-retry-exhausted", "stdout", normalize(cap.stdout))
    assertOrUpdate("adversarial-retry-exhausted", "stderr", normalize(cap.stderr))
  })

  it("(d) budget exceeded abort", async () => {
    const cap = await captureOutput(() => {
      printPhaseHeader(1, 1, "01-scaffold")
      printPhase("01-scaffold", "Budget exceeded: $1.05 > $1.00")
      printInfo("Budget limit reached: $1.05 > $1.00")
    })
    assertOrUpdate("budget-exceeded", "stdout", normalize(cap.stdout))
    assertOrUpdate("budget-exceeded", "stderr", normalize(cap.stderr))
  })

  it("(e) schema validation failure", async () => {
    const cap = await captureOutput(() => {
      printPhaseHeader(1, 1, "01-scaffold")
      printError("Schema validation failed: No valid JSON object found in output")
    })
    assertOrUpdate("schema-validation-failure", "stdout", normalize(cap.stdout))
    assertOrUpdate("schema-validation-failure", "stderr", normalize(cap.stderr))
  })

  describe("graceful degradation under non-TTY / NO_COLOR", () => {
    it("does not emit ANSI SGR or CSI cursor sequences when NO_COLOR is set", async () => {
      const cap = await captureOutput(() => {
        printError("error path produces no colour codes under NO_COLOR")
        printInfo("info path produces no colour codes under NO_COLOR")
      })
      const ESC = String.fromCharCode(27)
      expect(cap.stdout.includes(ESC)).toBe(false)
      expect(cap.stderr.includes(ESC)).toBe(false)
      expect(cap.stdout.includes("\r")).toBe(false)
    })
  })
})
