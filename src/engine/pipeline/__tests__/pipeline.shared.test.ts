import { describe, it, expect, vi, beforeEach } from "vitest"
import type { RidgelineConfig } from "../../../types"
import { makeConfig } from "../../../../test/factories"

vi.mock("../../discovery/agent.scan", () => ({
  discoverBuiltinAgents: vi.fn(() => new Map()),
  buildAgentsFlag: vi.fn(() => ({})),
}))

vi.mock("../../discovery/plugin.scan", () => ({
  discoverPluginDirs: vi.fn(() => []),
  getCorePluginDir: vi.fn(() => "/core/plugins"),
}))

vi.mock("../../../ui/output", () => ({
  printError: vi.fn(),
}))

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return { ...actual, readFileSync: vi.fn(() => "file content") }
})

import { prepareAgentsAndPlugins, createStderrHandler, appendConstraintsAndTaste, commonInvokeOptions } from "../pipeline.shared"
import { discoverBuiltinAgents, buildAgentsFlag } from "../../discovery/agent.scan"
import { discoverPluginDirs, getCorePluginDir } from "../../discovery/plugin.scan"
import { printError } from "../../../ui/output"
import * as fs from "node:fs"

beforeEach(() => vi.clearAllMocks())

describe("prepareAgentsAndPlugins", () => {
  it("returns agents and pluginDirs from discovery", () => {
    const agents = { scout: { description: "Scout", prompt: "..." } }
    vi.mocked(buildAgentsFlag).mockReturnValue(agents)
    vi.mocked(discoverPluginDirs).mockReturnValue([{ dir: "/plugin-a", createdPluginJson: false }])

    const result = prepareAgentsAndPlugins(makeConfig())

    expect(discoverBuiltinAgents).toHaveBeenCalled()
    expect(result.agents).toEqual(agents)
    expect(result.pluginDirs).toEqual([{ dir: "/plugin-a", createdPluginJson: false }])
  })

  it("returns undefined agents when agents map is empty", () => {
    vi.mocked(buildAgentsFlag).mockReturnValue({})

    const result = prepareAgentsAndPlugins(makeConfig())
    expect(result.agents).toBeUndefined()
  })

  it("appends core plugin dir when unsafe and no sandbox", () => {
    vi.mocked(buildAgentsFlag).mockReturnValue({})
    vi.mocked(discoverPluginDirs).mockReturnValue([])
    vi.mocked(getCorePluginDir).mockReturnValue("/core/plugins")

    const result = prepareAgentsAndPlugins(makeConfig({ unsafe: true, sandboxProvider: null }))
    expect(result.pluginDirs).toEqual([{ dir: "/core/plugins", createdPluginJson: false }])
  })

  it("does not append core plugin dir when sandbox is set", () => {
    vi.mocked(buildAgentsFlag).mockReturnValue({})
    vi.mocked(discoverPluginDirs).mockReturnValue([])

    const provider = { name: "bwrap", command: "bwrap", checkReady: () => null, buildArgs: () => [] }
    const result = prepareAgentsAndPlugins(makeConfig({ unsafe: true, sandboxProvider: provider }))
    expect(result.pluginDirs).toEqual([])
  })

  it("does not append core plugin dir when not unsafe", () => {
    vi.mocked(buildAgentsFlag).mockReturnValue({})
    vi.mocked(discoverPluginDirs).mockReturnValue([])

    const result = prepareAgentsAndPlugins(makeConfig({ unsafe: false }))
    expect(result.pluginDirs).toEqual([])
  })
})

describe("createStderrHandler", () => {
  it("calls printError for messages containing 'error'", () => {
    const handler = createStderrHandler()
    handler("Something error occurred")
    expect(printError).toHaveBeenCalledOnce()
  })

  it("calls printError for auth-related messages", () => {
    const handler = createStderrHandler()
    handler("Unauthorized access")
    expect(printError).toHaveBeenCalledOnce()
  })

  it("calls printError for forbidden messages", () => {
    const handler = createStderrHandler()
    handler("Forbidden resource")
    expect(printError).toHaveBeenCalledOnce()
  })

  it("ignores benign stderr", () => {
    const handler = createStderrHandler()
    handler("Starting process...")
    expect(printError).not.toHaveBeenCalled()
  })

  it("prefixes label when provided", () => {
    const handler = createStderrHandler("builder")
    handler("Error: something broke")
    expect(printError).toHaveBeenCalledWith(expect.stringContaining("[builder]"))
  })
})

describe("appendConstraintsAndTaste", () => {
  it("appends constraints section", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("constraints content")
    const sections: string[] = []

    appendConstraintsAndTaste(sections, makeConfig())

    expect(sections.join("\n")).toContain("## constraints.md")
    expect(sections.join("\n")).toContain("constraints content")
  })

  it("appends taste section when tastePath is set", () => {
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce("constraints")
      .mockReturnValueOnce("taste content")
    const sections: string[] = []

    appendConstraintsAndTaste(sections, makeConfig({ tastePath: "/tmp/taste.md" }))

    expect(sections.join("\n")).toContain("## taste.md")
    expect(sections.join("\n")).toContain("taste content")
  })

  it("omits taste section when tastePath is null", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("constraints")
    const sections: string[] = []

    appendConstraintsAndTaste(sections, makeConfig({ tastePath: null }))

    expect(sections.join("\n")).not.toContain("## taste.md")
  })

  it("appends extra context when present", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("constraints")
    const sections: string[] = []

    appendConstraintsAndTaste(sections, makeConfig({ extraContext: "additional info" }))

    expect(sections.join("\n")).toContain("## Additional Context")
    expect(sections.join("\n")).toContain("additional info")
  })

  it("omits extra context when null", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("constraints")
    const sections: string[] = []

    appendConstraintsAndTaste(sections, makeConfig({ extraContext: null }))

    expect(sections.join("\n")).not.toContain("## Additional Context")
  })
})

describe("commonInvokeOptions", () => {
  it("returns correct shape with timeout calculation", () => {
    const prepared = { agents: undefined, pluginDirs: [] as { dir: string; createdPluginJson: boolean }[] }
    const onStdout = vi.fn()

    const result = commonInvokeOptions(makeConfig({ timeoutMinutes: 60 }), prepared, onStdout)

    expect(result.timeoutMs).toBe(60 * 60 * 1000)
    expect(result.onStdout).toBe(onStdout)
    expect(result.additionalWritePaths).toContain("/tmp/build")
  })

  it("returns undefined pluginDirs when empty", () => {
    const prepared = { agents: undefined, pluginDirs: [] as { dir: string; createdPluginJson: boolean }[] }
    const result = commonInvokeOptions(makeConfig(), prepared, vi.fn())

    expect(result.pluginDirs).toBeUndefined()
  })

  it("returns pluginDir paths when present", () => {
    const prepared = {
      agents: undefined,
      pluginDirs: [{ dir: "/plugin-a", createdPluginJson: false }],
    }
    const result = commonInvokeOptions(makeConfig(), prepared, vi.fn())

    expect(result.pluginDirs).toEqual(["/plugin-a"])
  })

  it("passes through sandbox and network config", () => {
    const provider = { name: "bwrap", command: "bwrap", checkReady: () => null, buildArgs: () => [] }
    const prepared = { agents: undefined, pluginDirs: [] as { dir: string; createdPluginJson: boolean }[] }

    const result = commonInvokeOptions(
      makeConfig({ sandboxProvider: provider, networkAllowlist: ["api.example.com"] }),
      prepared,
      vi.fn(),
    )

    expect(result.sandboxProvider).toBe(provider)
    expect(result.networkAllowlist).toEqual(["api.example.com"])
  })
})
