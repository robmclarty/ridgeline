import { describe, it, expect } from "vitest"
import { buildToolSurface, buildTools, type ExecutorRole } from "../factory.js"
import type { ToolFactoryContext } from "../types.js"
import type { SandboxProvider } from "../../claude/sandbox.types.js"

const fakeProvider: SandboxProvider = {
  name: "greywall",
  command: "greywall",
  buildArgs: () => ["--"],
}

const ctx = (sandboxProvider: SandboxProvider | null): ToolFactoryContext => ({
  cwd: "/work",
  sandboxProvider,
  sandboxMode: sandboxProvider ? "semi-locked" : "off",
  sandboxExtras: { writePaths: [], readPaths: [], profiles: [], networkAllowlist: [] },
  networkAllowlist: [],
})

const names = (tools: { name: string }[]): string[] => tools.map((t) => t.name)

describe("buildToolSurface", () => {
  const sandboxed = ctx(fakeProvider)

  const expected: Record<ExecutorRole, string[]> = {
    builder: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    reviewer: ["Read", "Bash", "Glob", "Grep"],
    refiner: ["Read", "Write"],
    researcher: ["Read", "Glob", "Grep", "WebFetch"],
    planner: ["Read", "Glob", "Grep"],
    plan_reviewer: ["Read", "Glob", "Grep"],
    plan_reviser: ["Read", "Write", "Glob", "Grep"],
    retrospective: ["Read", "Glob", "Grep"],
  }

  for (const [role, want] of Object.entries(expected) as [ExecutorRole, string[]][]) {
    it(`${role} yields exactly ${want.join("/")} when sandboxed`, () => {
      expect(names(buildToolSurface(role, sandboxed))).toEqual(want)
    })
  }

  it("never emits Agent or Skill (claude_cli-only)", () => {
    for (const role of Object.keys(expected) as ExecutorRole[]) {
      const got = names(buildToolSurface(role, sandboxed))
      expect(got).not.toContain("Agent")
      expect(got).not.toContain("Skill")
    }
  })

  it("omits Bash for every role when no sandbox is active", () => {
    for (const role of Object.keys(expected) as ExecutorRole[]) {
      expect(names(buildToolSurface(role, ctx(null)))).not.toContain("Bash")
    }
  })

  it("keeps non-Bash tools intact when sandbox is off (builder)", () => {
    expect(names(buildToolSurface("builder", ctx(null)))).toEqual(["Read", "Write", "Edit", "Glob", "Grep"])
  })

  it("buildTools honors the same Bash gate", () => {
    expect(names(buildTools(["Read", "Bash"], ctx(null)))).toEqual(["Read"])
    expect(names(buildTools(["Read", "Bash"], sandboxed))).toEqual(["Read", "Bash"])
  })

  it("omits WebSearch unless a search backend is configured (opt-in)", () => {
    expect(names(buildToolSurface("researcher", sandboxed))).not.toContain("WebSearch")
    const withSearch = { ...ctx(fakeProvider), search: { searxngUrl: "http://localhost:8888" } }
    expect(names(buildToolSurface("researcher", withSearch))).toContain("WebSearch")
    const withDdg = { ...ctx(null), search: { duckduckgo: true } }
    expect(names(buildTools(["WebSearch"], withDdg))).toEqual(["WebSearch"])
  })
})
