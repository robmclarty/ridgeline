import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { Engine, EngineConfig } from "fascicle"

const createEngineMock = vi.fn<(config: EngineConfig) => Engine>()

vi.mock("fascicle", async () => {
  const actual = await vi.importActual<typeof import("fascicle")>("fascicle")
  return {
    ...actual,
    create_engine: (config: EngineConfig) => createEngineMock(config),
  }
})

const mockEngine = (): Engine => {
  const dispose = vi.fn(async () => {})
  return {
    generate: vi.fn() as unknown as Engine["generate"],
    register_alias: vi.fn(),
    unregister_alias: vi.fn(),
    resolve_alias: vi.fn() as unknown as Engine["resolve_alias"],
    list_aliases: vi.fn(),
    register_price: vi.fn(),
    resolve_price: vi.fn() as unknown as Engine["resolve_price"],
    list_prices: vi.fn(),
    dispose,
  } as unknown as Engine
}

const importFactory = async () => {
  const mod = await import("../engine.factory.js")
  return mod.makeRidgelineEngine
}

const baseCfg = {
  pluginDirs: [] as readonly string[],
  settingSources: [] as readonly ("user" | "project" | "local")[],
  buildPath: "/tmp/ridgeline-build-x",
}

describe("makeRidgelineEngine", () => {
  beforeEach(() => {
    createEngineMock.mockReset()
    createEngineMock.mockImplementation(() => mockEngine())
    delete process.env.VITEST_FACTORY_PROBE_OFF
  })

  afterEach(() => {
    delete process.env.VITEST_FACTORY_PROBE_OFF
  })

  const lastConfig = (): EngineConfig => {
    expect(createEngineMock).toHaveBeenCalled()
    return createEngineMock.mock.calls[createEngineMock.mock.calls.length - 1]![0]
  }

  it("passes auth_mode 'auto' regardless of cfg input", async () => {
    const make = await importFactory()
    for (const sandboxFlag of ["off", "semi-locked", "strict"] as const) {
      createEngineMock.mockClear()
      make({ ...baseCfg, sandboxFlag })
      expect(lastConfig().providers.claude_cli?.auth_mode).toBe("auto")
    }
  })

  it("returns sandbox=undefined for sandboxFlag='off'", async () => {
    const make = await importFactory()
    make({ ...baseCfg, sandboxFlag: "off" })
    expect(lastConfig().providers.claude_cli?.sandbox).toBeUndefined()
  })

  it("returns sandbox.kind='greywall' for semi-locked and strict", async () => {
    const make = await importFactory()
    for (const sandboxFlag of ["semi-locked", "strict"] as const) {
      createEngineMock.mockClear()
      make({ ...baseCfg, sandboxFlag })
      expect(lastConfig().providers.claude_cli?.sandbox?.kind).toBe("greywall")
    }
  })

  it("delegates greywall sandbox composition to buildSandboxPolicy (buildPath placement)", async () => {
    const make = await importFactory()
    make({ ...baseCfg, sandboxFlag: "strict", buildPath: "/tmp/ridgeline-build-strict" })
    const sandbox = lastConfig().providers.claude_cli?.sandbox
    expect(sandbox?.kind).toBe("greywall")
    expect(sandbox?.additional_write_paths?.[0]).toBe("/tmp/ridgeline-build-strict")
  })

  it("sets startup_timeout_ms to 120000 regardless of cfg input", async () => {
    const make = await importFactory()
    for (const timeoutMinutes of [undefined, 1, 10, 60]) {
      createEngineMock.mockClear()
      make({ ...baseCfg, sandboxFlag: "off", timeoutMinutes })
      expect(lastConfig().providers.claude_cli?.startup_timeout_ms).toBe(120_000)
    }
  })

  it("sets stall_timeout_ms to timeoutMinutes*60_000 when provided", async () => {
    const make = await importFactory()
    make({ ...baseCfg, sandboxFlag: "off", timeoutMinutes: 7 })
    expect(lastConfig().providers.claude_cli?.stall_timeout_ms).toBe(7 * 60_000)
  })

  it("sets stall_timeout_ms to 300000 when timeoutMinutes is omitted", async () => {
    const make = await importFactory()
    make({ ...baseCfg, sandboxFlag: "off" })
    expect(lastConfig().providers.claude_cli?.stall_timeout_ms).toBe(300_000)
  })

  it("registers each supplied price on the engine", async () => {
    const eng = mockEngine()
    createEngineMock.mockImplementation(() => eng)
    const make = await importFactory()
    make({
      ...baseCfg,
      sandboxFlag: "off",
      pricing: [
        { provider: "openrouter", modelId: "qwen/q", pricing: { input_per_million: 0.07, output_per_million: 0.26 } },
      ],
    })
    expect(eng.register_price).toHaveBeenCalledWith("openrouter", "qwen/q", {
      input_per_million: 0.07,
      output_per_million: 0.26,
    })
  })

  it("registers no prices when pricing is omitted", async () => {
    const eng = mockEngine()
    createEngineMock.mockImplementation(() => eng)
    const make = await importFactory()
    make({ ...baseCfg, sandboxFlag: "off" })
    expect(eng.register_price).not.toHaveBeenCalled()
  })

  it("sets skip_probe to true when VITEST==='true'", async () => {
    expect(process.env.VITEST).toBe("true")
    const make = await importFactory()
    make({ ...baseCfg, sandboxFlag: "off" })
    expect(lastConfig().providers.claude_cli?.skip_probe).toBe(true)
  })

  it("sets skip_probe to false when VITEST is not 'true'", async () => {
    const original = process.env.VITEST
    process.env.VITEST = "false"
    try {
      const make = await importFactory()
      createEngineMock.mockClear()
      make({ ...baseCfg, sandboxFlag: "off" })
      expect(lastConfig().providers.claude_cli?.skip_probe).toBe(false)
    } finally {
      process.env.VITEST = original
    }
  })

  it("passes plugin_dirs and setting_sources verbatim", async () => {
    const make = await importFactory()
    const pluginDirs = ["/abs/plugin-a", "/abs/plugin-b"] as const
    const settingSources = ["user", "project", "local"] as const
    make({ ...baseCfg, sandboxFlag: "off", pluginDirs, settingSources })
    const cli = lastConfig().providers.claude_cli
    expect(cli?.plugin_dirs).toEqual(pluginDirs)
    expect(cli?.setting_sources).toEqual(settingSources)
  })

  it("does not require ANTHROPIC_API_KEY for the claude_cli provider", async () => {
    const original = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      const make = await importFactory()
      make({ ...baseCfg, sandboxFlag: "semi-locked" })
      const cli = lastConfig().providers.claude_cli
      expect(cli?.api_key).toBeUndefined()
      expect(cli?.auth_mode).toBe("auto")
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = original
    }
  })

  it("omits the anthropic provider when ANTHROPIC_API_KEY is not set", async () => {
    const original = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      const make = await importFactory()
      make({ ...baseCfg, sandboxFlag: "off" })
      expect(lastConfig().providers.anthropic).toBeUndefined()
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = original
    }
  })

  it("registers the anthropic provider with the env api_key when ANTHROPIC_API_KEY is set", async () => {
    const original = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key"
    try {
      const make = await importFactory()
      make({ ...baseCfg, sandboxFlag: "off" })
      expect(lastConfig().providers.anthropic).toEqual({ api_key: "sk-ant-test-key" })
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = original
    }
  })

  it("passes no aliases — delegates model resolution to fascicle's catalog", async () => {
    const original = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      const make = await importFactory()
      make({ ...baseCfg, sandboxFlag: "off" })
      expect(lastConfig().aliases).toBeUndefined()
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = original
    }
  })

  it("defaults the provider to claude_cli when ANTHROPIC_API_KEY is unset", async () => {
    const original = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      const make = await importFactory()
      make({ ...baseCfg, sandboxFlag: "off" })
      expect(lastConfig().defaults?.provider).toBe("claude_cli")
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = original
    }
  })

  it("defaults the provider to anthropic (and passes no aliases) when ANTHROPIC_API_KEY is set", async () => {
    const original = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key"
    try {
      const make = await importFactory()
      make({ ...baseCfg, sandboxFlag: "off" })
      expect(lastConfig().defaults?.provider).toBe("anthropic")
      expect(lastConfig().aliases).toBeUndefined()
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = original
    }
  })

  it("uses cfg.provider as the default provider when supplied", async () => {
    const original = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      const make = await importFactory()
      make({ ...baseCfg, sandboxFlag: "off", provider: "openai" })
      expect(lastConfig().defaults?.provider).toBe("openai")
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = original
    }
  })

  it("activates the openai provider from OPENAI_API_KEY", async () => {
    const original = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = "sk-openai-test"
    try {
      const make = await importFactory()
      make({ ...baseCfg, sandboxFlag: "off" })
      expect(lastConfig().providers.openai).toEqual({ api_key: "sk-openai-test" })
    } finally {
      if (original === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = original
    }
  })

  it("merges cfg.providers but reserves the ridgeline-owned claude_cli wiring", async () => {
    const make = await importFactory()
    make({
      ...baseCfg,
      sandboxFlag: "off",
      providers: {
        ollama: { base_url: "http://localhost:11434" },
        claude_cli: { binary: "should-be-ignored" },
      },
    })
    const cfg = lastConfig()
    expect(cfg.providers.ollama).toEqual({ base_url: "http://localhost:11434" })
    expect(cfg.providers.claude_cli?.auth_mode).toBe("auto")
    expect(cfg.providers.claude_cli?.binary).toBeUndefined()
  })

  it("named export is `makeRidgelineEngine` (camelCase)", async () => {
    const mod = await import("../engine.factory.js")
    expect(typeof mod.makeRidgelineEngine).toBe("function")
    expect("make_ridgeline_engine" in mod).toBe(false)
    expect("createRidgelineEngine" in mod).toBe(false)
  })
})
