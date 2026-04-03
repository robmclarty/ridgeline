import { describe, it, expect } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir, trackTempDir } from "../../../test/setup"
import {
  parseFrontmatter,
  discoverAgentsInDir,
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
    expect(discoverAgentsInDir("/nonexistent/path", new Set())).toEqual([])
  })

  it("returns empty array for empty directory", () => {
    const dir = trackTempDir(makeTempDir())
    expect(discoverAgentsInDir(dir, new Set())).toEqual([])
  })

  it("discovers .md files with valid frontmatter", () => {
    const dir = trackTempDir(makeTempDir())
    writeAgent(dir, "db-expert.md", validAgent("db-expert", "Database specialist", "sonnet"))

    const agents = discoverAgentsInDir(dir, new Set())
    expect(agents).toHaveLength(1)
    expect(agents[0].name).toBe("db-expert")
    expect(agents[0].description).toBe("Database specialist")
    expect(agents[0].model).toBe("sonnet")
    expect(agents[0].filename).toBe("db-expert.md")
    expect(agents[0].prompt).toContain("You are db-expert.")
  })

  it("skips files in the exclude set", () => {
    const dir = trackTempDir(makeTempDir())
    writeAgent(dir, "builder.md", validAgent("builder", "Core builder"))
    writeAgent(dir, "specialist.md", validAgent("specialist", "A specialist"))

    const agents = discoverAgentsInDir(dir, new Set(["builder.md"]))
    expect(agents).toHaveLength(1)
    expect(agents[0].name).toBe("specialist")
  })

  it("skips non-.md files", () => {
    const dir = trackTempDir(makeTempDir())
    writeAgent(dir, "specialist.md", validAgent("specialist", "A specialist"))
    fs.writeFileSync(path.join(dir, ".core"), "builder.md\n")
    fs.writeFileSync(path.join(dir, "notes.txt"), "some notes")

    const agents = discoverAgentsInDir(dir, new Set())
    expect(agents).toHaveLength(1)
    expect(agents[0].name).toBe("specialist")
  })

  it("skips files with malformed frontmatter", () => {
    const dir = trackTempDir(makeTempDir())
    writeAgent(dir, "good.md", validAgent("good", "Good agent"))
    writeAgent(dir, "bad.md", "No frontmatter here")

    const agents = discoverAgentsInDir(dir, new Set())
    expect(agents).toHaveLength(1)
    expect(agents[0].name).toBe("good")
  })
})

describe("buildAgentsFlag", () => {
  const makeAgent = (
    name: string,
    model: string | null = null
  ): DiscoveredAgent => ({
    name,
    description: `${name} description`,
    prompt: `You are ${name}.`,
    model,
    filename: `${name}.md`,
  })

  it("returns empty object for empty array", () => {
    expect(buildAgentsFlag([])).toEqual({})
  })

  it("includes model when present", () => {
    const result = buildAgentsFlag([makeAgent("test", "sonnet")])
    expect(result.test.model).toBe("sonnet")
  })

  it("omits model when null", () => {
    const result = buildAgentsFlag([makeAgent("test")])
    expect(result.test).not.toHaveProperty("model")
  })

  it("uses description as-is", () => {
    const result = buildAgentsFlag([makeAgent("test")])
    expect(result.test.description).toBe("test description")
  })
})
