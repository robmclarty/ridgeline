import { describe, it, expect, vi, afterEach } from "vitest"
import { EventEmitter } from "node:events"
import type { spawn } from "node:child_process"
import type { ToolExecContext } from "fascicle"
import { makeBashTool } from "../bash.tool.js"
import type { ToolFactoryContext } from "../types.js"
import type { SandboxProvider } from "../../claude/sandbox.types.js"

const flush = (): Promise<void> => new Promise((r) => setImmediate(r))

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; pid: number }

const makeFakeChild = (): FakeChild => {
  const child = new EventEmitter() as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.pid = 4242
  return child
}

const makeFakeSpawn = (order: string[]) => {
  const calls: { binary: string; args: string[] }[] = []
  let child: FakeChild | null = null
  const spawnFn = ((binary: string, args: string[]) => {
    order.push("spawn")
    calls.push({ binary, args })
    child = makeFakeChild()
    return child
  }) as unknown as typeof spawn
  return { spawnFn, calls, getChild: () => child as FakeChild }
}

const greywall = (order: string[]): SandboxProvider => ({
  name: "greywall",
  command: "greywall",
  buildArgs: () => ["--profile", "claude", "--"],
  syncRules: vi.fn(async (allowlist: string[]) => {
    order.push(`syncRules:${allowlist.join(",")}`)
  }),
})

const ctxFor = (extra: Partial<ToolFactoryContext>): ToolFactoryContext => ({
  cwd: "/work",
  sandboxProvider: null,
  sandboxMode: "semi-locked",
  sandboxExtras: { writePaths: [], readPaths: [], profiles: [], networkAllowlist: [] },
  networkAllowlist: ["api.example.com"],
  ...extra,
})

const toolCtx = (signal: AbortSignal): ToolExecContext => ({
  abort: signal,
  tool_call_id: "t",
  step_index: 0,
})

describe("Bash tool", () => {
  afterEach(() => vi.restoreAllMocks())

  it("syncs network rules BEFORE spawning and wraps the command in greywall", async () => {
    const order: string[] = []
    const { spawnFn, calls, getChild } = makeFakeSpawn(order)
    const provider = greywall(order)
    const tool = makeBashTool(ctxFor({ sandboxProvider: provider, spawnFn }))

    const p = tool.execute({ command: "echo hi" }, toolCtx(new AbortController().signal))
    await flush()

    expect(provider.syncRules).toHaveBeenCalledWith(["api.example.com"])
    expect(order).toEqual(["syncRules:api.example.com", "spawn"])
    expect(calls[0].binary).toBe("greywall")
    expect(calls[0].args).toEqual(["--profile", "claude", "--", "bash", "-c", "echo hi"])

    getChild().stdout.emit("data", Buffer.from("hi\n"))
    getChild().emit("close", 0)
    expect(await p).toBe("hi\n")
  })

  it("rejects (surfaces a tool error) when the sandboxed command exits non-zero", async () => {
    const order: string[] = []
    const { spawnFn, getChild } = makeFakeSpawn(order)
    const tool = makeBashTool(ctxFor({ sandboxProvider: greywall(order), spawnFn }))

    const p = tool.execute({ command: "echo x > /etc/evil" }, toolCtx(new AbortController().signal))
    await flush()
    getChild().stderr.emit("data", Buffer.from("bash: /etc/evil: Permission denied"))
    getChild().emit("close", 1)

    await expect(p).rejects.toThrow(/exit 1: bash: \/etc\/evil: Permission denied/)
  })

  it("does NOT pass disallowed hosts to syncRules (greyproxy never opens them)", async () => {
    const order: string[] = []
    const { spawnFn, getChild } = makeFakeSpawn(order)
    const provider = greywall(order)
    const tool = makeBashTool(
      ctxFor({ sandboxProvider: provider, spawnFn, networkAllowlist: ["api.example.com"] }),
    )

    const p = tool.execute({ command: "curl https://evil.test" }, toolCtx(new AbortController().signal))
    await flush()
    expect(provider.syncRules).toHaveBeenCalledWith(["api.example.com"])
    expect((provider.syncRules as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toContain("evil.test")
    getChild().emit("close", 0)
    await p
  })

  it("runs raw bash (no greywall) when no sandbox provider is active", async () => {
    const order: string[] = []
    const { spawnFn, calls, getChild } = makeFakeSpawn(order)
    const tool = makeBashTool(ctxFor({ sandboxProvider: null, spawnFn }))

    const p = tool.execute({ command: "echo hi" }, toolCtx(new AbortController().signal))
    await flush()
    expect(calls[0].binary).toBe("bash")
    expect(calls[0].args).toEqual(["-c", "echo hi"])
    getChild().emit("close", 0)
    await p
  })

  it("kills the process group and rejects on abort", async () => {
    const order: string[] = []
    const { spawnFn, getChild } = makeFakeSpawn(order)
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true)
    const controller = new AbortController()
    const tool = makeBashTool(ctxFor({ sandboxProvider: greywall(order), spawnFn }))

    const p = tool.execute({ command: "sleep 999" }, toolCtx(controller.signal))
    await flush()
    controller.abort()

    await expect(p).rejects.toThrow(/aborted/)
    expect(killSpy).toHaveBeenCalledWith(-getChild().pid, "SIGTERM")
  })
})
