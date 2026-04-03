import { describe, it, expect } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir, trackTempDir } from "../../../test/setup"
import {
  parseFrontmatter,
  discoverAgentsInDir,
  discoverSpecialistAgents,
  buildAgentsFlag,
  DiscoveredAgent,
} from "../agentDiscovery"

const writeAgent = (dir: string, filename: string, content: string): void => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, filename), content)
}

const validAgent = (name: string, description: string, model?: string): string => {
  const modelLine = model ? `\nmodel: ${model}` : ""
  return `---\nname: ${name}\ndescription: ${description}${modelLine}\n---\n\nYou are ${name}.`
}

describe("parseFrontmatter", () => {
  it("extracts name, description, and model", () => {
    const result = parseFrontmatter(validAgent("test", "A test agent", "opus"))
    expect(result).toEqual({ name: "test", description: "A test agent", model: "opus" })
  })

  it("returns null model when model is absent", () => {
    const result = parseFrontmatter(validAgent("test", "A test agent"))
    expect(result).toEqual({ name: "test", description: "A test agent", model: null })
  })

  it("returns null when name is missing", () => {
    const content = "---\ndescription: A test agent\n---\n\nBody"
    expect(parseFrontmatter(content)).toBeNull()
  })

  it("returns null when description is missing", () => {
    const content = "---\nname: test\n---\n\nBody"
    expect(parseFrontmatter(content)).toBeNull()
  })

  it("returns null when no frontmatter delimiters", () => {
    expect(parseFrontmatter("Just some markdown")).toBeNull()
  })

  it("handles colons in description", () => {
    const content = "---\nname: test\ndescription: Schema design: PostgreSQL focus\n---\n"
    const result = parseFrontmatter(content)
    expect(result?.description).toBe("Schema design: PostgreSQL focus")
  })
})

describe("discoverAgentsInDir", () => {
  it("returns empty array for nonexistent directory", () => {
    expect(discoverAgentsInDir("/nonexistent/path", "build", new Set())).toEqual([])
  })

  it("returns empty array for empty directory", () => {
    const dir = trackTempDir(makeTempDir())
    expect(discoverAgentsInDir(dir, "build", new Set())).toEqual([])
  })

  it("discovers .md files with valid frontmatter", () => {
    const dir = trackTempDir(makeTempDir())
    writeAgent(dir, "db-expert.md", validAgent("db-expert", "Database specialist", "sonnet"))

    const agents = discoverAgentsInDir(dir, "project", new Set())
    expect(agents).toHaveLength(1)
    expect(agents[0].name).toBe("db-expert")
    expect(agents[0].description).toBe("Database specialist")
    expect(agents[0].model).toBe("sonnet")
    expect(agents[0].tier).toBe("project")
    expect(agents[0].filename).toBe("db-expert.md")
    expect(agents[0].prompt).toContain("You are db-expert.")
  })

  it("skips files in the exclude set", () => {
    const dir = trackTempDir(makeTempDir())
    writeAgent(dir, "builder.md", validAgent("builder", "Core builder"))
    writeAgent(dir, "specialist.md", validAgent("specialist", "A specialist"))

    const agents = discoverAgentsInDir(dir, "builtin", new Set(["builder.md"]))
    expect(agents).toHaveLength(1)
    expect(agents[0].name).toBe("specialist")
  })

  it("skips non-.md files", () => {
    const dir = trackTempDir(makeTempDir())
    writeAgent(dir, "specialist.md", validAgent("specialist", "A specialist"))
    fs.writeFileSync(path.join(dir, ".core"), "builder.md\n")
    fs.writeFileSync(path.join(dir, "notes.txt"), "some notes")

    const agents = discoverAgentsInDir(dir, "builtin", new Set())
    expect(agents).toHaveLength(1)
    expect(agents[0].name).toBe("specialist")
  })

  it("skips files with malformed frontmatter", () => {
    const dir = trackTempDir(makeTempDir())
    writeAgent(dir, "good.md", validAgent("good", "Good agent"))
    writeAgent(dir, "bad.md", "No frontmatter here")

    const agents = discoverAgentsInDir(dir, "build", new Set())
    expect(agents).toHaveLength(1)
    expect(agents[0].name).toBe("good")
  })
})

describe("discoverSpecialistAgents", () => {
  it("returns empty array when no agent directories exist", () => {
    const dir = trackTempDir(makeTempDir())
    const config = {
      buildDir: path.join(dir, "builds", "test"),
      ridgelineDir: dir,
    }
    // @ts-expect-error — partial config for testing
    const agents = discoverSpecialistAgents(config)
    expect(agents).toEqual([])
  })

  it("discovers build-level agents", () => {
    const dir = trackTempDir(makeTempDir())
    const buildDir = path.join(dir, "builds", "test")
    writeAgent(path.join(buildDir, "agents"), "auth.md", validAgent("auth", "Auth specialist"))

    const config = { buildDir, ridgelineDir: dir }
    // @ts-expect-error — partial config for testing
    const agents = discoverSpecialistAgents(config)
    expect(agents).toHaveLength(1)
    expect(agents[0].name).toBe("auth")
    expect(agents[0].tier).toBe("build")
  })

  it("discovers project-level agents", () => {
    const dir = trackTempDir(makeTempDir())
    const buildDir = path.join(dir, "builds", "test")
    writeAgent(path.join(dir, "agents"), "db.md", validAgent("db", "Database expert"))

    const config = { buildDir, ridgelineDir: dir }
    // @ts-expect-error — partial config for testing
    const agents = discoverSpecialistAgents(config)
    expect(agents).toHaveLength(1)
    expect(agents[0].name).toBe("db")
    expect(agents[0].tier).toBe("project")
  })

  it("deduplicates: build-level wins over project-level", () => {
    const dir = trackTempDir(makeTempDir())
    const buildDir = path.join(dir, "builds", "test")
    writeAgent(path.join(buildDir, "agents"), "auth.md", validAgent("auth", "Build auth"))
    writeAgent(path.join(dir, "agents"), "auth.md", validAgent("auth", "Project auth"))

    const config = { buildDir, ridgelineDir: dir }
    // @ts-expect-error — partial config for testing
    const agents = discoverSpecialistAgents(config)
    expect(agents).toHaveLength(1)
    expect(agents[0].tier).toBe("build")
    expect(agents[0].description).toBe("Build auth")
  })
})

describe("buildAgentsFlag", () => {
  const makeAgent = (
    name: string,
    tier: AgentTier,
    model: string | null = null
  ): DiscoveredAgent => ({
    name,
    description: `${name} description`,
    prompt: `You are ${name}.`,
    model,
    tier,
    filename: `${name}.md`,
  })

  it("returns empty object for empty array", () => {
    expect(buildAgentsFlag([])).toEqual({})
  })

  it("includes model when present", () => {
    const result = buildAgentsFlag([makeAgent("test", "builtin", "sonnet")])
    expect(result.test.model).toBe("sonnet")
  })

  it("omits model when null", () => {
    const result = buildAgentsFlag([makeAgent("test", "builtin")])
    expect(result.test).not.toHaveProperty("model")
  })

  it("prefixes description for build-tier agents", () => {
    const result = buildAgentsFlag([makeAgent("auth", "build")])
    expect(result.auth.description).toBe("[build specialist] auth description")
  })

  it("prefixes description for project-tier agents", () => {
    const result = buildAgentsFlag([makeAgent("db", "project")])
    expect(result.db.description).toBe("[project specialist] db description")
  })

  it("does not prefix description for builtin-tier agents", () => {
    const result = buildAgentsFlag([makeAgent("test", "builtin")])
    expect(result.test.description).toBe("test description")
  })
})
