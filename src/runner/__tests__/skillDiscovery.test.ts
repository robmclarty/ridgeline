import { describe, it, expect } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir, trackTempDir } from "../../../test/setup"
import { discoverSkillDirs, cleanupSkillDirs } from "../skillDiscovery"

const writeSkill = (dir: string, skillName: string, content: string): void => {
  const skillDir = path.join(dir, "skills", skillName)
  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), content)
}

const makeConfig = (tmpDir: string) => {
  const ridgelineDir = tmpDir
  const buildDir = path.join(tmpDir, "builds", "test-build")
  fs.mkdirSync(buildDir, { recursive: true })
  return { ridgelineDir, buildDir, buildName: "test-build" }
}

describe("discoverSkillDirs", () => {
  it("returns empty array when no skills directories exist", () => {
    const dir = trackTempDir(makeTempDir())
    const config = makeConfig(dir)
    // @ts-expect-error — partial config for testing
    expect(discoverSkillDirs(config)).toEqual([])
  })

  it("discovers project-level skills directory", () => {
    const dir = trackTempDir(makeTempDir())
    const config = makeConfig(dir)
    writeSkill(config.ridgelineDir, "my-skill", "---\nname: my-skill\n---\nContent")

    // @ts-expect-error — partial config for testing
    const result = discoverSkillDirs(config)
    expect(result).toHaveLength(1)
    expect(result[0].dir).toBe(config.ridgelineDir)
    expect(result[0].createdPluginJson).toBe(true)
  })

  it("discovers build-level skills directory", () => {
    const dir = trackTempDir(makeTempDir())
    const config = makeConfig(dir)
    writeSkill(config.buildDir, "build-skill", "---\nname: build-skill\n---\nContent")

    // @ts-expect-error — partial config for testing
    const result = discoverSkillDirs(config)
    expect(result).toHaveLength(1)
    expect(result[0].dir).toBe(config.buildDir)
  })

  it("discovers both levels when both have skills", () => {
    const dir = trackTempDir(makeTempDir())
    const config = makeConfig(dir)
    writeSkill(config.buildDir, "build-skill", "---\nname: build-skill\n---\nContent")
    writeSkill(config.ridgelineDir, "project-skill", "---\nname: project-skill\n---\nContent")

    // @ts-expect-error — partial config for testing
    const result = discoverSkillDirs(config)
    expect(result).toHaveLength(2)
  })

  it("creates plugin.json when missing", () => {
    const dir = trackTempDir(makeTempDir())
    const config = makeConfig(dir)
    writeSkill(config.ridgelineDir, "my-skill", "content")

    // @ts-expect-error — partial config for testing
    discoverSkillDirs(config)

    const pluginJson = path.join(config.ridgelineDir, "plugin.json")
    expect(fs.existsSync(pluginJson)).toBe(true)
    const content = JSON.parse(fs.readFileSync(pluginJson, "utf-8"))
    expect(content.name).toBe("ridgeline-project")
  })

  it("does not overwrite existing plugin.json", () => {
    const dir = trackTempDir(makeTempDir())
    const config = makeConfig(dir)
    writeSkill(config.ridgelineDir, "my-skill", "content")

    const pluginJson = path.join(config.ridgelineDir, "plugin.json")
    fs.writeFileSync(pluginJson, JSON.stringify({ name: "user-plugin", description: "custom" }))

    // @ts-expect-error — partial config for testing
    const result = discoverSkillDirs(config)
    expect(result[0].createdPluginJson).toBe(false)

    const content = JSON.parse(fs.readFileSync(pluginJson, "utf-8"))
    expect(content.name).toBe("user-plugin")
  })

  it("skips empty skills directories", () => {
    const dir = trackTempDir(makeTempDir())
    const config = makeConfig(dir)
    fs.mkdirSync(path.join(config.ridgelineDir, "skills"), { recursive: true })

    // @ts-expect-error — partial config for testing
    expect(discoverSkillDirs(config)).toEqual([])
  })
})

describe("cleanupSkillDirs", () => {
  it("removes auto-generated plugin.json", () => {
    const dir = trackTempDir(makeTempDir())
    const config = makeConfig(dir)
    writeSkill(config.ridgelineDir, "my-skill", "content")

    // @ts-expect-error — partial config for testing
    const dirs = discoverSkillDirs(config)
    const pluginJson = path.join(config.ridgelineDir, "plugin.json")
    expect(fs.existsSync(pluginJson)).toBe(true)

    cleanupSkillDirs(dirs)
    expect(fs.existsSync(pluginJson)).toBe(false)
  })

  it("does not remove user-created plugin.json", () => {
    const dir = trackTempDir(makeTempDir())
    const config = makeConfig(dir)
    writeSkill(config.ridgelineDir, "my-skill", "content")

    const pluginJson = path.join(config.ridgelineDir, "plugin.json")
    fs.writeFileSync(pluginJson, JSON.stringify({ name: "user-plugin", description: "custom" }))

    // @ts-expect-error — partial config for testing
    const dirs = discoverSkillDirs(config)
    cleanupSkillDirs(dirs)

    expect(fs.existsSync(pluginJson)).toBe(true)
  })

  it("does not remove plugin.json that was not auto-generated this run", () => {
    const dir = trackTempDir(makeTempDir())
    const pluginJson = path.join(dir, "plugin.json")
    fs.writeFileSync(pluginJson, JSON.stringify({ name: "other", description: "ridgeline-auto-generated" }))

    // Simulate a dir entry where we didn't create the plugin.json
    cleanupSkillDirs([{ dir, createdPluginJson: false }])
    expect(fs.existsSync(pluginJson)).toBe(true)
  })
})
