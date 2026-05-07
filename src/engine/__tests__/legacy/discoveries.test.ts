import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  appendDiscovery,
  readDiscoveries,
  getDiscoveriesPath,
  type DiscoveryEntry,
} from "../../discoveries.js"

describe("discoveries", () => {
  let buildDir: string

  beforeEach(() => {
    buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-discoveries-"))
  })

  afterEach(() => {
    fs.rmSync(buildDir, { recursive: true, force: true })
  })

  const sample = (overrides: Partial<DiscoveryEntry> = {}): DiscoveryEntry => ({
    ts: "2026-05-06T23:14:57.000Z",
    phase_id: "02-sandbox-policy",
    blocker: "agnix postinstall blocked by sandbox network",
    solution: "symlinked main's agnix-binary into worktree",
    source: "auto",
    ...overrides,
  })

  it("returns an empty array when no log file exists", () => {
    expect(readDiscoveries(buildDir)).toEqual([])
  })

  it("appends and reads back a single entry", () => {
    const entry = sample()
    appendDiscovery(buildDir, entry)
    expect(readDiscoveries(buildDir)).toEqual([entry])
  })

  it("preserves entry order across multiple appends", () => {
    const a = sample({ phase_id: "02-sandbox-policy" })
    const b = sample({ phase_id: "03-adapters", solution: "different fix" })
    const c = sample({ phase_id: "05-composites", source: "agent" })
    appendDiscovery(buildDir, a)
    appendDiscovery(buildDir, b)
    appendDiscovery(buildDir, c)
    expect(readDiscoveries(buildDir)).toEqual([a, b, c])
  })

  it("creates intermediate directories for the log file", () => {
    const nested = path.join(buildDir, "deeply", "nested", "build")
    appendDiscovery(nested, sample())
    expect(fs.existsSync(getDiscoveriesPath(nested))).toBe(true)
  })

  it("writes one JSON object per line", () => {
    appendDiscovery(buildDir, sample({ phase_id: "a" }))
    appendDiscovery(buildDir, sample({ phase_id: "b" }))
    const raw = fs.readFileSync(getDiscoveriesPath(buildDir), "utf-8")
    const lines = raw.split("\n").filter((l) => l.length > 0)
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  it("ignores blank lines when reading", () => {
    const filePath = getDiscoveriesPath(buildDir)
    fs.mkdirSync(buildDir, { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(sample()) + "\n\n\n")
    expect(readDiscoveries(buildDir)).toHaveLength(1)
  })
})
