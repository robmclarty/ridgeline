import { describe, it, expect } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir, trackTempDir } from "../../../../test/setup.js"
import { discoverPluginDirs, cleanupPluginDirs, getBundledPluginDir } from "../plugin.scan.js"

const writePlugin = (baseDir: string, filename: string, content: string): void => {
  const pluginDir = path.join(baseDir, "plugin")
  fs.mkdirSync(pluginDir, { recursive: true })
  fs.writeFileSync(path.join(pluginDir, filename), content)
}

const writeSkill = (baseDir: string, skillName: string, content: string): void => {
  const skillDir = path.join(baseDir, "plugin", "skills", skillName)
  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), content)
}

const writeAgentPlugin = (baseDir: string, agentName: string, content: string): void => {
  const agentDir = path.join(baseDir, "plugin", "agents")
  fs.mkdirSync(agentDir, { recursive: true })
  fs.writeFileSync(path.join(agentDir, `${agentName}.md`), content)
}

const makeConfig = (tmpDir: string) => {
  const ridgelineDir = tmpDir
  const buildDir = path.join(tmpDir, "builds", "test-build")
  fs.mkdirSync(buildDir, { recursive: true })
  return { ridgelineDir, buildDir, buildName: "test-build" }
}

// Helper to filter only user-level dirs (exclude bundled plugin dirs)
const userDirs = (dirs: Array<{ dir: string; createdPluginJson: boolean }>, config: { ridgelineDir: string; buildDir: string }) =>
  dirs.filter(d => d.dir.startsWith(config.ridgelineDir) || d.dir.startsWith(config.buildDir))

describe("discoverPluginDirs", () => {
  it("returns no user-level dirs when no plugin directories exist", () => {
    const dir = trackTempDir(makeTempDir())
    const config = makeConfig(dir)
    // @ts-expect-error — partial config for testing
    expect(userDirs(discoverPluginDirs(config), config)).toEqual([])
  })

  it("discovers project-level plugin directory with skills", () => {
    const dir = trackTempDir(makeTempDir())
    const config = makeConfig(dir)
    writeSkill(config.ridgelineDir, "my-skill", "---\nname: my-skill\n---\nContent")

    // @ts-expect-error — partial config for testing
    const result = userDirs(discoverPluginDirs(config), config)
    expect(result).toHaveLength(1)
    expect(result[0].dir).toBe(path.join(config.ridgelineDir, "plugin"))
    expect(result[0].createdPluginJson).toBe(true)
  })

  it("discovers project-level plugin directory with agents", () => {
    const dir = trackTempDir(makeTempDir())
    const config = makeConfig(dir)
    writeAgentPlugin(config.ridgelineDir, "db-expert", "---\nname: db-expert\n---\nContent")

    // @ts-expect-error — partial config for testing
    const result = userDirs(discoverPluginDirs(config), config)
    expect(result).toHaveLength(1)
    expect(result[0].dir).toBe(path.join(config.ridgelineDir, "plugin"))
  })

  it("discovers build-level plugin directory", () => {
    const dir = trackTempDir(makeTempDir())
    const config = makeConfig(dir)
    writeSkill(config.buildDir, "build-skill", "---\nname: build-skill\n---\nContent")

    // @ts-expect-error — partial config for testing
    const result = userDirs(discoverPluginDirs(config), config)
    expect(result).toHaveLength(1)
    expect(result[0].dir).toBe(path.join(config.buildDir, "plugin"))
  })

  it("discovers both levels when both have plugins", () => {
    const dir = trackTempDir(makeTempDir())
    const config = makeConfig(dir)
    writeSkill(config.buildDir, "build-skill", "content")
    writeSkill(config.ridgelineDir, "project-skill", "content")

    // @ts-expect-error — partial config for testing
    const result = userDirs(discoverPluginDirs(config), config)
    expect(result).toHaveLength(2)
  })

  it("creates plugin.json when missing", () => {
    const dir = trackTempDir(makeTempDir())
    const config = makeConfig(dir)
    writeSkill(config.ridgelineDir, "my-skill", "content")

    // @ts-expect-error — partial config for testing
    discoverPluginDirs(config)

    const pluginJson = path.join(config.ridgelineDir, "plugin", "plugin.json")
    expect(fs.existsSync(pluginJson)).toBe(true)
    const content = JSON.parse(fs.readFileSync(pluginJson, "utf-8"))
    expect(content.name).toBe("ridgeline-project")
  })

  it("does not overwrite existing plugin.json", () => {
    const dir = trackTempDir(makeTempDir())
    const config = makeConfig(dir)
    writeSkill(config.ridgelineDir, "my-skill", "content")

    const pluginJson = path.join(config.ridgelineDir, "plugin", "plugin.json")
    fs.writeFileSync(pluginJson, JSON.stringify({ name: "user-plugin", description: "custom" }))

    // @ts-expect-error — partial config for testing
    const result = userDirs(discoverPluginDirs(config), config)
    expect(result[0].createdPluginJson).toBe(false)

    const content = JSON.parse(fs.readFileSync(pluginJson, "utf-8"))
    expect(content.name).toBe("user-plugin")
  })

  it("skips empty plugin directories", () => {
    const dir = trackTempDir(makeTempDir())
    const config = makeConfig(dir)
    fs.mkdirSync(path.join(config.ridgelineDir, "plugin"), { recursive: true })

    // @ts-expect-error — partial config for testing
    expect(userDirs(discoverPluginDirs(config), config)).toEqual([])
  })
})

describe("cleanupPluginDirs", () => {
  it("removes auto-generated plugin.json", () => {
    const dir = trackTempDir(makeTempDir())
    const config = makeConfig(dir)
    writeSkill(config.ridgelineDir, "my-skill", "content")

    // @ts-expect-error — partial config for testing
    const dirs = discoverPluginDirs(config)
    const pluginJson = path.join(config.ridgelineDir, "plugin", "plugin.json")
    expect(fs.existsSync(pluginJson)).toBe(true)

    cleanupPluginDirs(dirs)
    expect(fs.existsSync(pluginJson)).toBe(false)
  })

  it("does not remove user-created plugin.json", () => {
    const dir = trackTempDir(makeTempDir())
    const config = makeConfig(dir)
    writePlugin(config.ridgelineDir, "plugin.json", JSON.stringify({ name: "user", description: "custom" }))
    writeSkill(config.ridgelineDir, "my-skill", "content")

    // @ts-expect-error — partial config for testing
    const dirs = discoverPluginDirs(config)
    cleanupPluginDirs(dirs)

    const pluginJson = path.join(config.ridgelineDir, "plugin", "plugin.json")
    expect(fs.existsSync(pluginJson)).toBe(true)
  })

  it("does not remove plugin.json when createdPluginJson is false", () => {
    const dir = trackTempDir(makeTempDir())
    const pluginDir = path.join(dir, "plugin")
    fs.mkdirSync(pluginDir, { recursive: true })
    const pluginJson = path.join(pluginDir, "plugin.json")
    fs.writeFileSync(pluginJson, JSON.stringify({ name: "other", description: "ridgeline-auto-generated" }))

    cleanupPluginDirs([{ dir: pluginDir, createdPluginJson: false }])
    expect(fs.existsSync(pluginJson)).toBe(true)
  })
})

describe("getBundledPluginDir", () => {
  it("returns a string or null", () => {
    const result = getBundledPluginDir()
    expect(result === null || typeof result === "string").toBe(true)
  })

  it("returns a directory that exists when non-null", () => {
    const result = getBundledPluginDir()
    if (result !== null) {
      expect(fs.existsSync(result)).toBe(true)
      expect(fs.statSync(result).isDirectory()).toBe(true)
    }
  })
})

describe("discoverPluginDirs includes bundled plugins", () => {
  it("includes bundled plugin dirs in results when bundled root exists", () => {
    const dir = trackTempDir(makeTempDir())
    const config = makeConfig(dir)

    // @ts-expect-error — partial config for testing
    const result = discoverPluginDirs(config)
    const bundledRoot = getBundledPluginDir()

    if (bundledRoot) {
      // Bundled plugins should appear in results
      const bundledDirs = result.filter(d => d.dir.startsWith(bundledRoot))
      expect(bundledDirs.length).toBeGreaterThan(0)

      // All bundled dirs should have createdPluginJson false
      for (const d of bundledDirs) {
        expect(d.createdPluginJson).toBe(false)
      }

      // Each bundled dir should have a plugin.json
      for (const d of bundledDirs) {
        expect(fs.existsSync(path.join(d.dir, "plugin.json"))).toBe(true)
      }
    }
  })

  it("bundled plugin dirs are real directories with plugin.json", () => {
    const bundledRoot = getBundledPluginDir()
    if (!bundledRoot) return

    // Verify the structure that discoverPluginDirs relies on
    const entries = fs.readdirSync(bundledRoot)
    for (const entry of entries) {
      const subdir = path.join(bundledRoot, entry)
      if (!fs.statSync(subdir).isDirectory()) continue
      if (!fs.existsSync(path.join(subdir, "plugin.json"))) continue

      // This subdir should appear in discoverPluginDirs results
      const dir = trackTempDir(makeTempDir())
      const config = makeConfig(dir)
      // @ts-expect-error — partial config for testing
      const result = discoverPluginDirs(config)
      const match = result.find(d => d.dir === subdir)
      expect(match).toBeDefined()
      expect(match!.createdPluginJson).toBe(false)
    }
  })
})
