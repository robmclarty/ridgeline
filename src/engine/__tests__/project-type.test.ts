import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { detectProject } from "../project-type.js"

const FIXTURES = path.resolve(__dirname, "../../../test/fixtures")

describe("detectProject", () => {
  describe("fixture projects", () => {
    it("React+Vite with design.md is a visual surface with full sensor suite", async () => {
      const report = await detectProject(path.join(FIXTURES, "react-vite-design"))
      expect(report.projectType).toBe("web")
      expect(report.isVisualSurface).toBe(true)
      expect(report.detectedDeps).toEqual(expect.arrayContaining(["react", "vite"]))
      expect(report.hasDesignMd).toBe(true)
      expect(report.suggestedSensors.sort()).toEqual(["a11y", "contrast", "playwright", "vision"])
      expect(report.suggestedEnsembleSize).toBe(3)
    })

    it("pure Node project (express only) has no sensors", async () => {
      const report = await detectProject(path.join(FIXTURES, "pure-node"))
      expect(report.projectType).toBe("node")
      expect(report.isVisualSurface).toBe(false)
      expect(report.detectedDeps).toEqual([])
      expect(report.hasDesignMd).toBe(false)
      expect(report.suggestedSensors).toEqual([])
    })

    it("pure HTML (no package.json) is unknown but visual via filesystem signal", async () => {
      const report = await detectProject(path.join(FIXTURES, "pure-html"))
      expect(report.projectType).toBe("unknown")
      expect(report.isVisualSurface).toBe(true)
      expect(report.suggestedSensors.length).toBe(4)
    })

    it("Vue+Vite project is web with full sensor suite", async () => {
      const report = await detectProject(path.join(FIXTURES, "vue-vite"))
      expect(report.projectType).toBe("web")
      expect(report.isVisualSurface).toBe(true)
      expect(report.detectedDeps).toEqual(expect.arrayContaining(["vue", "vite"]))
      expect(report.suggestedSensors.length).toBe(4)
    })

    it("monorepo root with no visual deps and no visual files is node", async () => {
      const report = await detectProject(path.join(FIXTURES, "monorepo-root"))
      expect(report.projectType).toBe("node")
      expect(report.isVisualSurface).toBe(false)
      expect(report.detectedDeps).toEqual([])
      expect(report.suggestedSensors).toEqual([])
    })
  })

  describe("filesystem-only signals", () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-detect-"))
    })

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it("treats a single .jsx file (no package.json) as a visual surface", async () => {
      fs.writeFileSync(path.join(tmpDir, "Component.jsx"), "export default () => null\n")
      const report = await detectProject(tmpDir)
      expect(report.isVisualSurface).toBe(true)
      expect(report.projectType).toBe("unknown")
      expect(report.suggestedSensors.length).toBe(4)
    })

    it("treats a single .svelte file as a visual surface", async () => {
      fs.writeFileSync(path.join(tmpDir, "App.svelte"), "<script></script><div></div>\n")
      const report = await detectProject(tmpDir)
      expect(report.isVisualSurface).toBe(true)
    })

    it("ignores files inside node_modules / dist / build / .git", async () => {
      for (const dir of ["node_modules", "dist", "build", ".git"]) {
        fs.mkdirSync(path.join(tmpDir, dir))
        fs.writeFileSync(path.join(tmpDir, dir, "buried.jsx"), "x\n")
      }
      const report = await detectProject(tmpDir)
      expect(report.isVisualSurface).toBe(false)
    })

    it("ignores files inside coverage and test fixtures dirs", async () => {
      for (const dir of ["coverage", "fixtures"]) {
        fs.mkdirSync(path.join(tmpDir, dir), { recursive: true })
        fs.writeFileSync(path.join(tmpDir, dir, "report.html"), "<html></html>\n")
      }
      const testFixturesDir = path.join(tmpDir, "test", "fixtures")
      fs.mkdirSync(testFixturesDir, { recursive: true })
      fs.writeFileSync(path.join(testFixturesDir, "App.tsx"), "export {}\n")
      const report = await detectProject(tmpDir)
      expect(report.isVisualSurface).toBe(false)
      expect(report.visualFileExts).toEqual([])
    })

    it("populates visualFileExts when the file scan is the only signal", async () => {
      fs.writeFileSync(path.join(tmpDir, "page.html"), "<!doctype html>\n")
      fs.writeFileSync(path.join(tmpDir, "Component.tsx"), "export {}\n")
      const report = await detectProject(tmpDir)
      expect(report.isVisualSurface).toBe(true)
      expect(report.visualFileExts).toEqual(["html", "tsx"])
    })

    it("leaves visualFileExts empty when a visual dep is detected (skip the scan)", async () => {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ dependencies: { react: "^18.0.0" } }),
      )
      fs.writeFileSync(path.join(tmpDir, "App.tsx"), "export {}\n")
      const report = await detectProject(tmpDir)
      expect(report.isVisualSurface).toBe(true)
      expect(report.detectedDeps).toContain("react")
      expect(report.visualFileExts).toEqual([])
    })
  })

  describe("package.json edge cases", () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-detect-pkg-"))
    })

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it("handles missing package.json without throwing", async () => {
      const report = await detectProject(tmpDir)
      expect(report.projectType).toBe("unknown")
      expect(report.isVisualSurface).toBe(false)
    })

    it("warns and falls back to filesystem on malformed package.json", async () => {
      fs.writeFileSync(path.join(tmpDir, "package.json"), "{ not valid json")
      fs.writeFileSync(path.join(tmpDir, "page.html"), "<!doctype html><html></html>")
      const report = await detectProject(tmpDir)
      expect(report.detectedDeps).toEqual([])
      expect(report.isVisualSurface).toBe(true)
    })
  })

  describe("ensemble size and thoroughness", () => {
    it("defaults to ensemble size 3", async () => {
      const report = await detectProject(path.join(FIXTURES, "pure-node"))
      expect(report.suggestedEnsembleSize).toBe(3)
    })

    it("returns the requested ensemble size when specialistCount is set", async () => {
      const report = await detectProject(path.join(FIXTURES, "pure-node"), { specialistCount: 2 })
      expect(report.suggestedEnsembleSize).toBe(2)
    })

    it("supports a single-specialist ensemble", async () => {
      const report = await detectProject(path.join(FIXTURES, "pure-node"), { specialistCount: 1 })
      expect(report.suggestedEnsembleSize).toBe(1)
    })
  })

  describe("determinism", () => {
    it("produces byte-identical serialized reports for unchanged inputs", async () => {
      const a = await detectProject(path.join(FIXTURES, "react-vite-design"))
      const b = await detectProject(path.join(FIXTURES, "react-vite-design"))
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    })

    it("sorts detected deps alphabetically", async () => {
      const report = await detectProject(path.join(FIXTURES, "react-vite-design"))
      const sorted = [...report.detectedDeps].sort()
      expect(report.detectedDeps).toEqual(sorted)
    })
  })

  describe("performance", () => {
    it("completes in under 1 second on a small project", async () => {
      const start = Date.now()
      await detectProject(path.join(FIXTURES, "react-vite-design"))
      expect(Date.now() - start).toBeLessThan(1000)
    })
  })
})
