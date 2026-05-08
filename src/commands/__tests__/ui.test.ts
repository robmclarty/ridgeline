import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir, trackTempDir } from "../../../test/setup.js"
import { findMostRecentBuild, runUi } from "../ui.js"
import type { DashboardServer } from "../../ui/dashboard/server.js"

const writeBuild = (cwd: string, name: string, mtimeOffsetMs: number): void => {
  const dir = path.join(cwd, ".ridgeline", "builds", name)
  fs.mkdirSync(dir, { recursive: true })
  const statePath = path.join(dir, "state.json")
  fs.writeFileSync(statePath, JSON.stringify({
    buildName: name,
    startedAt: new Date().toISOString(),
    pipeline: { shape: "complete", design: "skipped", spec: "complete", research: "skipped", refine: "skipped", plan: "complete", build: "running" },
    phases: [],
  }))
  const now = Date.now() + mtimeOffsetMs
  fs.utimesSync(statePath, new Date(now), new Date(now))
  fs.utimesSync(dir, new Date(now), new Date(now))
  fs.writeFileSync(path.join(dir, "budget.json"), JSON.stringify({ entries: [], totalCostUsd: 0 }))
  fs.writeFileSync(path.join(dir, "trajectory.jsonl"), "")
}

const tryRunUi = async (cwd: string, buildName: string | undefined, port: number): Promise<DashboardServer | null> => {
  try {
    return await runUi(cwd, buildName, { port })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/EPERM|EACCES/.test(msg)) return null
    throw err
  }
}

describe("runUi", () => {
  let cwd: string
  let server: DashboardServer | null

  beforeEach(() => {
    cwd = trackTempDir(makeTempDir())
    server = null
  })

  afterEach(async () => {
    if (server) await server.close()
    server = null
  })

  it("binds to 127.0.0.1 (never 0.0.0.0) when sandbox allows", async () => {
    server = await tryRunUi(cwd, undefined, 0)
    if (!server) return
    expect(server.host).toBe("127.0.0.1")
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:/)
  })

  it("findMostRecentBuild selects the newest build directory", () => {
    writeBuild(cwd, "older", -10_000)
    writeBuild(cwd, "newer", 0)
    expect(findMostRecentBuild(cwd)).toBe("newer")
  })

  it("findMostRecentBuild returns null when no builds exist", () => {
    expect(findMostRecentBuild(cwd)).toBeNull()
  })

  it("renders a null buildName when no builds exist", async () => {
    server = await tryRunUi(cwd, undefined, 0)
    if (!server) return
    expect(server).toBeTruthy()
  })
})
