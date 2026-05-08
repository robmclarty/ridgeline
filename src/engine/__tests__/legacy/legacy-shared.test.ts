import { describe, it, expect, vi, beforeEach } from "vitest"
import { makeConfig } from "../../../../test/factories.js"

vi.mock("../../discovery/agent.registry.js", () => ({
  buildAgentRegistry: vi.fn(() => ({
    getCorePrompt: vi.fn(() => ""),
    getSpecialists: vi.fn(() => []),
    getSpecialist: vi.fn(() => null),
    getContext: vi.fn(() => null),
    getGaps: vi.fn(() => null),
    getSubAgents: vi.fn(() => []),
    getAgentsFlag: vi.fn(() => ({})),
  })),
}))

vi.mock("../../discovery/plugin.scan.js", () => ({
  discoverPluginDirs: vi.fn(() => []),
  getCorePluginDir: vi.fn(() => "/core/plugins"),
}))

vi.mock("../../../ui/output.js", () => ({
  printError: vi.fn(),
}))

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return { ...actual, readFileSync: vi.fn(() => "file content"), existsSync: vi.fn(() => false) }
})

import { prepareAgentsAndPlugins, createStderrHandler, appendConstraintsAndTaste, appendDesign, appendAssetCatalog, commonInvokeOptions } from "../../legacy-shared.js"
import { createPromptDocument } from "../../prompt-document.js"
import { buildAgentRegistry } from "../../discovery/agent.registry.js"
import { discoverPluginDirs, getCorePluginDir } from "../../discovery/plugin.scan.js"
import { printError } from "../../../ui/output.js"
import * as fs from "node:fs"

beforeEach(() => vi.clearAllMocks())

describe("prepareAgentsAndPlugins", () => {
  it("returns agents and pluginDirs from discovery", () => {
    const agents = { explorer: { description: "Explorer", prompt: "..." } }
    const mockRegistry = {
      getCorePrompt: vi.fn(() => ""),
      getSpecialists: vi.fn(() => []),
      getSpecialist: vi.fn(() => null),
      getContext: vi.fn(() => null),
      getGaps: vi.fn(() => null),
      getSubAgents: vi.fn(() => []),
      getAgentsFlag: vi.fn(() => agents),
    }
    vi.mocked(buildAgentRegistry).mockReturnValue(mockRegistry)
    vi.mocked(discoverPluginDirs).mockReturnValue([{ dir: "/plugin-a", createdPluginJson: false }])

    const result = prepareAgentsAndPlugins(makeConfig())

    expect(buildAgentRegistry).toHaveBeenCalled()
    expect(result.agents).toEqual(agents)
    expect(result.pluginDirs).toEqual([{ dir: "/plugin-a", createdPluginJson: false }])
  })

  it("returns undefined agents when agents map is empty", () => {
    const mockRegistry = {
      getCorePrompt: vi.fn(() => ""),
      getSpecialists: vi.fn(() => []),
      getSpecialist: vi.fn(() => null),
      getContext: vi.fn(() => null),
      getGaps: vi.fn(() => null),
      getSubAgents: vi.fn(() => []),
      getAgentsFlag: vi.fn(() => ({})),
    }
    vi.mocked(buildAgentRegistry).mockReturnValue(mockRegistry)

    const result = prepareAgentsAndPlugins(makeConfig())
    expect(result.agents).toBeUndefined()
  })

  it("appends core plugin dir when unsafe and no sandbox", () => {
    vi.mocked(discoverPluginDirs).mockReturnValue([])
    vi.mocked(getCorePluginDir).mockReturnValue("/core/plugins")

    const result = prepareAgentsAndPlugins(makeConfig({ unsafe: true, sandboxProvider: null }))
    expect(result.pluginDirs).toEqual([{ dir: "/core/plugins", createdPluginJson: false }])
  })

  it("does not append core plugin dir when sandbox is set", () => {
    vi.mocked(discoverPluginDirs).mockReturnValue([])

    const provider = { name: "greywall" as const, command: "greywall", checkReady: () => null, buildArgs: () => [] as string[] }
    const result = prepareAgentsAndPlugins(makeConfig({ unsafe: true, sandboxProvider: provider }))
    expect(result.pluginDirs).toEqual([])
  })

  it("does not append core plugin dir when not unsafe", () => {
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
    const doc = createPromptDocument()

    appendConstraintsAndTaste(doc, makeConfig())

    const rendered = doc.render()
    expect(rendered).toContain("## constraints.md")
    expect(rendered).toContain("constraints content")
    expect(doc.inspect()[0]).toMatchObject({ role: "data", heading: "constraints.md" })
  })

  it("appends taste section when tastePath is set", () => {
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce("constraints")
      .mockReturnValueOnce("taste content")
    const doc = createPromptDocument()

    appendConstraintsAndTaste(doc, makeConfig({ tastePath: "/tmp/taste.md" }))

    const rendered = doc.render()
    expect(rendered).toContain("## taste.md")
    expect(rendered).toContain("taste content")
  })

  it("omits taste section when tastePath is null", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("constraints")
    const doc = createPromptDocument()

    appendConstraintsAndTaste(doc, makeConfig({ tastePath: null }))

    expect(doc.render()).not.toContain("## taste.md")
  })

  it("appends extra context when present", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("constraints")
    const doc = createPromptDocument()

    appendConstraintsAndTaste(doc, makeConfig({ extraContext: "additional info" }))

    const rendered = doc.render()
    expect(rendered).toContain("## Additional Context")
    expect(rendered).toContain("additional info")
  })

  it("omits extra context when null", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("constraints")
    const doc = createPromptDocument()

    appendConstraintsAndTaste(doc, makeConfig({ extraContext: null }))

    expect(doc.render()).not.toContain("## Additional Context")
  })
})

describe("appendDesign", () => {
  it("injects feature-level design.md when it exists", () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => String(p).includes("/tmp/build"))
    vi.mocked(fs.readFileSync).mockReturnValue("feature design content")
    const doc = createPromptDocument()

    appendDesign(doc, makeConfig())

    const rendered = doc.render()
    expect(rendered).toContain("## Feature Design")
    expect(rendered).toContain("feature design content")
  })

  it("injects project-level design.md when it exists", () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const s = String(p)
      return s.includes("ridgeline/design.md") && !s.includes("/tmp/build")
    })
    vi.mocked(fs.readFileSync).mockReturnValue("project design content")
    const doc = createPromptDocument()

    appendDesign(doc, makeConfig())

    const rendered = doc.render()
    expect(rendered).toContain("## Project Design")
    expect(rendered).toContain("project design content")
  })

  it("injects both levels when both exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
      if (String(p).includes("/tmp/build")) return "feature design"
      return "project design"
    })
    const doc = createPromptDocument()

    appendDesign(doc, makeConfig())

    const rendered = doc.render()
    expect(rendered).toContain("## Project Design")
    expect(rendered).toContain("## Feature Design")
  })

  it("does nothing when no design.md exists", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const doc = createPromptDocument()

    appendDesign(doc, makeConfig())

    expect(doc.inspect()).toHaveLength(0)
  })
})

describe("appendAssetCatalog", () => {
  it("injects asset catalog reference when build-level catalog exists", () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).includes("asset-catalog.json") && String(p).includes("/tmp/build"),
    )
    const doc = createPromptDocument()

    appendAssetCatalog(doc, makeConfig())

    const rendered = doc.render()
    expect(rendered).toContain("## Available Assets")
    expect(rendered).toContain("asset-catalog.json")
    expect(rendered).toContain("suggested_anchor")
    expect(doc.inspect()[0]).toMatchObject({ role: "instruction" })
  })

  it("falls back to project-level catalog", () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const s = String(p)
      return s.includes("asset-catalog.json") && s.includes("ridgeline/asset-catalog") && !s.includes("/tmp/build")
    })
    const doc = createPromptDocument()

    appendAssetCatalog(doc, makeConfig())

    expect(doc.render()).toContain("## Available Assets")
  })

  it("does nothing when no catalog exists", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const doc = createPromptDocument()

    appendAssetCatalog(doc, makeConfig())

    expect(doc.inspect()).toHaveLength(0)
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
    const provider = { name: "greywall" as const, command: "greywall", checkReady: () => null, buildArgs: () => [] as string[] }
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
