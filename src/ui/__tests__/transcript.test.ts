import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { initTranscript, appendTranscript } from "../transcript"

describe("transcript", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-transcript-"))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("appends plain text with a trailing newline", () => {
    initTranscript(tmpDir)
    appendTranscript("hello world")
    const contents = fs.readFileSync(path.join(tmpDir, "transcript.log"), "utf8")
    expect(contents).toBe("hello world\n")
  })

  it("does not double-add a newline when text already ends with one", () => {
    initTranscript(tmpDir)
    appendTranscript("line one\n")
    appendTranscript("line two\n")
    const contents = fs.readFileSync(path.join(tmpDir, "transcript.log"), "utf8")
    expect(contents).toBe("line one\nline two\n")
  })

  it("strips ANSI escape sequences", () => {
    initTranscript(tmpDir)
    appendTranscript("\x1b[90mdim text\x1b[0m")
    const contents = fs.readFileSync(path.join(tmpDir, "transcript.log"), "utf8")
    expect(contents).toBe("dim text\n")
  })
})
