import { describe, it, expect, beforeEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { atomicWriteSync } from "../atomic-write"
import { makeTempDir } from "../../../test/setup"

describe("atomicWriteSync", () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })

  it("writes content to a new file", () => {
    const fp = path.join(tmpDir, "test.json")
    atomicWriteSync(fp, '{"hello":"world"}\n')
    expect(fs.readFileSync(fp, "utf-8")).toBe('{"hello":"world"}\n')
  })

  it("overwrites an existing file", () => {
    const fp = path.join(tmpDir, "test.json")
    fs.writeFileSync(fp, "old content")
    atomicWriteSync(fp, "new content")
    expect(fs.readFileSync(fp, "utf-8")).toBe("new content")
  })

  it("leaves no .tmp files after a successful write", () => {
    const fp = path.join(tmpDir, "state.json")
    atomicWriteSync(fp, '{"ok":true}')
    const leftover = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".tmp"))
    expect(leftover).toHaveLength(0)
  })

  it("round-trips JSON content faithfully", () => {
    const fp = path.join(tmpDir, "budget.json")
    const data = { entries: [{ cost: 1.23 }], totalCostUsd: 1.23 }
    const content = JSON.stringify(data, null, 2) + "\n"
    atomicWriteSync(fp, content)
    const parsed = JSON.parse(fs.readFileSync(fp, "utf-8"))
    expect(parsed).toEqual(data)
  })
})
