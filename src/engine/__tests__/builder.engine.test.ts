import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { uniformStageModels } from "../../../test/factories.js"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { RidgelineConfig, PhaseInfo } from "../../types.js"
import { cannedGenerateResult, stubEngine } from "../atoms/__tests__/_stub.engine.js"

vi.mock("../claude-process.js", () => ({ runClaudeProcess: vi.fn() }))
vi.mock("../../ui/claude-stream-display.js", () => ({
  createStreamDisplay: () => ({ onChunk: () => {}, flush: () => {} }),
  createLegacyStdoutDisplay: () => ({ onStdout: () => {}, flush: () => {} }),
}))
vi.mock("../discovery/agent.registry.js", () => ({
  buildAgentRegistry: () => ({ getCorePrompt: () => "BUILDER SYSTEM" }),
}))
vi.mock("../legacy-shared.js", () => ({
  appendConstraintsAndTaste: () => {},
  appendDesign: () => {},
  appendAssetCatalog: () => {},
  prepareAgentsAndPlugins: () => ({ agents: undefined, pluginDirs: [] }),
  commonInvokeOptions: () => ({ cwd: process.cwd() }),
}))
vi.mock("../../stores/handoff.js", () => ({ readHandoff: () => null }))
vi.mock("../discoveries.js", () => ({ getDiscoveriesPath: () => "/tmp/disc.jsonl", readDiscoveries: () => [] }))
vi.mock("../discovery/plugin.scan.js", () => ({ cleanupPluginDirs: () => {} }))

import { runBuilderViaEngine } from "../builder.js"

describe("runBuilderViaEngine", () => {
  let tmp: string
  let config: RidgelineConfig
  let phase: PhaseInfo

  beforeEach(() => {
    vi.clearAllMocks()
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-builder-eng-"))
    const buildDir = path.join(tmp, "build")
    fs.mkdirSync(buildDir, { recursive: true })
    fs.writeFileSync(path.join(tmp, "constraints.md"), "# Constraints")
    const phaseFile = path.join(buildDir, "01-scaffold.md")
    fs.writeFileSync(phaseFile, "# Phase 1")
    phase = { id: "01-scaffold", index: 1, slug: "scaffold", filename: "01-scaffold.md", filepath: phaseFile, dependsOn: [] }
    config = {
      buildName: "test",
      ridgelineDir: tmp,
      buildDir,
      constraintsPath: path.join(tmp, "constraints.md"),
      tastePath: null,
      handoffPath: path.join(buildDir, "handoff.md"),
      phasesDir: buildDir,
      model: "openai:gpt-4o",
      models: uniformStageModels("openai:gpt-4o"),
      maxRetries: 2,
      timeoutMinutes: 30,
      checkTimeoutSeconds: 1200,
      checkCommand: null,
      maxBudgetUsd: null,
      unsafe: false,
      sandboxMode: "off",
      sandboxExtras: { writePaths: [], readPaths: [], profiles: [], networkAllowlist: [] },
      networkAllowlist: [],
      extraContext: null,
      specialistCount: 2,
      specialistTimeoutSeconds: 180,
      phaseBudgetLimit: 15,
      phaseTokenLimit: 80000,
      sequencing: { kind: "sequential" },
    }
  })

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it("runs the builder through the engine with the full tool surface and max_steps", async () => {
    const engine = stubEngine(cannedGenerateResult("READY_FOR_REVIEW"))

    const result = await runBuilderViaEngine(config, phase, null, undefined, undefined, engine)

    expect(engine.generate).toHaveBeenCalledTimes(1)
    const opts = engine.generate.mock.calls[0]![0]
    // Sandbox off → Bash dropped; the rest of the builder surface is present.
    expect((opts.tools ?? []).map((t) => t.name)).toEqual(["Read", "Write", "Edit", "Glob", "Grep"])
    expect(opts.max_steps).toBe(80)
    expect(result.result).toContain("READY_FOR_REVIEW")
  })
})
