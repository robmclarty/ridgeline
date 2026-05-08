import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup.js"

// Mock process.cwd() to use temp directories
const originalCwd = process.cwd.bind(process)
let tmpDir: string

beforeEach(() => {
  tmpDir = makeTempDir()
  process.cwd = () => tmpDir
})

afterEach(() => {
  process.cwd = originalCwd
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// Dynamic import to pick up cwd mock
const loadModule = async () => {
  // Clear module cache to ensure fresh import with mocked cwd
  vi.resetModules()
  return import("../resolve-asset-dir.js")
}

describe("resolveAssetDir", () => {
  it("uses explicit --asset-dir when provided", async () => {
    const assetDir = path.join(tmpDir, "my-sprites")
    fs.mkdirSync(assetDir, { recursive: true })

    const { resolveAssetDir } = await loadModule()
    expect(resolveAssetDir(null, assetDir)).toBe(assetDir)
  })

  it("throws when explicit --asset-dir does not exist", async () => {
    const { resolveAssetDir } = await loadModule()
    expect(() => resolveAssetDir(null, "/nonexistent/dir")).toThrow("Asset directory not found")
  })

  it("finds build-scoped assets", async () => {
    const buildAssets = path.join(tmpDir, ".ridgeline", "builds", "test-build", "assets")
    fs.mkdirSync(buildAssets, { recursive: true })

    const { resolveAssetDir } = await loadModule()
    expect(resolveAssetDir("test-build")).toBe(buildAssets)
  })

  it("finds project-scoped assets", async () => {
    const projectAssets = path.join(tmpDir, ".ridgeline", "assets")
    fs.mkdirSync(projectAssets, { recursive: true })

    const { resolveAssetDir } = await loadModule()
    expect(resolveAssetDir(null)).toBe(projectAssets)
  })

  it("prefers build-scoped over project-scoped", async () => {
    const buildAssets = path.join(tmpDir, ".ridgeline", "builds", "test-build", "assets")
    const projectAssets = path.join(tmpDir, ".ridgeline", "assets")
    fs.mkdirSync(buildAssets, { recursive: true })
    fs.mkdirSync(projectAssets, { recursive: true })

    const { resolveAssetDir } = await loadModule()
    expect(resolveAssetDir("test-build")).toBe(buildAssets)
  })

  it("reads assetDir from settings.json", async () => {
    const customDir = path.join(tmpDir, "custom-assets")
    fs.mkdirSync(customDir, { recursive: true })

    const ridgelineDir = path.join(tmpDir, ".ridgeline")
    fs.mkdirSync(ridgelineDir, { recursive: true })
    fs.writeFileSync(
      path.join(ridgelineDir, "settings.json"),
      JSON.stringify({ assetDir: "custom-assets" })
    )

    const { resolveAssetDir } = await loadModule()
    expect(resolveAssetDir(null)).toBe(customDir)
  })

  it("throws with checked paths when nothing found", async () => {
    const { resolveAssetDir } = await loadModule()
    expect(() => resolveAssetDir("test-build")).toThrow("No asset directory found")
    expect(() => resolveAssetDir("test-build")).toThrow("--asset-dir")
  })
})

describe("resolveAssetDirSafe", () => {
  it("returns null instead of throwing", async () => {
    const { resolveAssetDirSafe } = await loadModule()
    expect(resolveAssetDirSafe("nonexistent")).toBeNull()
  })

  it("returns path when found", async () => {
    const assetDir = path.join(tmpDir, ".ridgeline", "assets")
    fs.mkdirSync(assetDir, { recursive: true })

    const { resolveAssetDirSafe } = await loadModule()
    expect(resolveAssetDirSafe(null)).toBe(assetDir)
  })
})
