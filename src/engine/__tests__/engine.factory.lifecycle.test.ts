import { describe, it, expect, vi, beforeEach } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Engine, EngineConfig } from "fascicle"

const callOrder: string[] = []
let createEngineCount = 0

const recordingEngine = (): Engine => ({
  generate: vi.fn() as unknown as Engine["generate"],
  register_alias: vi.fn(),
  unregister_alias: vi.fn(),
  resolve_alias: vi.fn() as unknown as Engine["resolve_alias"],
  list_aliases: vi.fn(),
  register_price: vi.fn(),
  resolve_price: vi.fn() as unknown as Engine["resolve_price"],
  list_prices: vi.fn(),
  dispose: vi.fn(async () => {
    callOrder.push("dispose")
  }),
} as unknown as Engine)

vi.mock("fascicle", async () => {
  const actual = await vi.importActual<typeof import("fascicle")>("fascicle")
  return {
    ...actual,
    create_engine: (_: EngineConfig) => {
      createEngineCount += 1
      callOrder.push("create_engine")
      return recordingEngine()
    },
  }
})

const makeRidgelineConfigShape = (buildPath: string) => {
  const buildDir = buildPath
  const buildName = path.basename(buildPath)
  const ridgelineDir = path.dirname(path.dirname(buildPath))
  return { buildDir, buildName, ridgelineDir } as unknown as Parameters<
    typeof import("../discovery/plugin.scan").discoverPluginDirs
  >[0]
}

describe("makeRidgelineEngine lifecycle (discoverPluginDirs / cleanupPluginDirs)", () => {
  beforeEach(() => {
    callOrder.length = 0
    createEngineCount = 0
    vi.resetModules()
  })

  it("orders discoverPluginDirs → create_engine → engine.dispose() → cleanupPluginDirs", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-factory-lifecycle-"))
    const ridgelineDir = path.join(tmpRoot, ".ridgeline")
    const buildPath = path.join(ridgelineDir, "builds", "my-build")
    fs.mkdirSync(buildPath, { recursive: true })
    fs.mkdirSync(path.join(buildPath, "plugin"), { recursive: true })
    fs.writeFileSync(path.join(buildPath, "plugin", "marker.md"), "x", "utf-8")

    try {
      const pluginScan = await import("../discovery/plugin.scan")
      const { makeRidgelineEngine } = await import("../engine.factory")

      const discoverSpy = vi.spyOn(pluginScan, "discoverPluginDirs").mockImplementation((cfg) => {
        callOrder.push("discoverPluginDirs")
        return [{ dir: path.join(cfg.buildDir, "plugin"), createdPluginJson: true }]
      })
      const cleanupSpy = vi.spyOn(pluginScan, "cleanupPluginDirs").mockImplementation(() => {
        callOrder.push("cleanupPluginDirs")
      })

      const discovered = pluginScan.discoverPluginDirs(makeRidgelineConfigShape(buildPath))
      const pluginDirs = discovered.map((d) => d.dir)

      const engine = makeRidgelineEngine({
        sandboxFlag: "off",
        pluginDirs,
        settingSources: [],
        buildPath,
      })

      await engine.dispose()
      pluginScan.cleanupPluginDirs(discovered)

      expect(discoverSpy).toHaveBeenCalledTimes(1)
      expect(cleanupSpy).toHaveBeenCalledTimes(1)
      expect(createEngineCount).toBe(1)

      expect(callOrder).toEqual([
        "discoverPluginDirs",
        "create_engine",
        "dispose",
        "cleanupPluginDirs",
      ])

      const idxDiscover = callOrder.indexOf("discoverPluginDirs")
      const idxCreate = callOrder.indexOf("create_engine")
      const idxDispose = callOrder.indexOf("dispose")
      const idxCleanup = callOrder.indexOf("cleanupPluginDirs")
      expect(idxDiscover).toBeLessThan(idxCreate)
      expect(idxDispose).toBeLessThan(idxCleanup)
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })
})
