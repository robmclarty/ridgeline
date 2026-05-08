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

  it("passes auth_mode 'oauth' regardless of cfg input", async () => {
    const make = await importFactory()
    for (const sandboxFlag of ["off", "semi-locked", "strict"] as const) {
      createEngineMock.mockClear()
      make({ ...baseCfg, sandboxFlag })
      expect(lastConfig().providers.claude_cli?.auth_mode).toBe("oauth")
    }
  })

  // sandbox is intentionally undefined regardless of sandboxFlag — fascicle's
  // greywall arg builder uses `--allow-host` / `--rw` flags that the current
  // greywall release dropped. Sandboxing for fascicle-routed calls is wired
  // through ridgeline's runClaudeProcess path, not here.
  it("always passes sandbox=undefined to fascicle's claude_cli provider", async () => {
    const make = await importFactory()
    for (const sandboxFlag of ["off", "semi-locked", "strict"] as const) {
      createEngineMock.mockClear()
      make({ ...baseCfg, sandboxFlag })
      expect(lastConfig().providers.claude_cli?.sandbox).toBeUndefined()
    }
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
      expect(cli?.auth_mode).toBe("oauth")
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

  it("registers anthropic-alias overrides routing to claude_cli when ANTHROPIC_API_KEY is unset", async () => {
    const original = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      const make = await importFactory()
      make({ ...baseCfg, sandboxFlag: "off" })
      const aliases = lastConfig().aliases
      expect(aliases?.opus).toEqual({ provider: "claude_cli", model_id: "claude-opus-4-7" })
      expect(aliases?.sonnet).toEqual({ provider: "claude_cli", model_id: "claude-sonnet-4-6" })
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = original
    }
  })

  it("leaves fascicle's default aliases in place when ANTHROPIC_API_KEY is set", async () => {
    const original = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key"
    try {
      const make = await importFactory()
      make({ ...baseCfg, sandboxFlag: "off" })
      expect(lastConfig().aliases).toBeUndefined()
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = original
    }
  })

  it("named export is `makeRidgelineEngine` (camelCase)", async () => {
    const mod = await import("../engine.factory.js")
    expect(typeof mod.makeRidgelineEngine).toBe("function")
    expect("make_ridgeline_engine" in mod).toBe(false)
    expect("createRidgelineEngine" in mod).toBe(false)
  })
})
