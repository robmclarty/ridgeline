import { describe, expect, it } from "vitest"
import type { DetectionReport } from "../../engine/detect"
import { renderPreflight } from "../preflight"
import { stripAnsi } from "../color"

const visualReport: DetectionReport = {
  projectType: "web",
  isVisualSurface: true,
  detectedDeps: ["react", "vite"],
  visualFileExts: [],
  hasDesignMd: true,
  hasAssetDir: false,
  suggestedSensors: ["playwright", "vision", "a11y", "contrast"],
  suggestedEnsembleSize: 2,
}

describe("preflight caching threshold warning", () => {
  const resolvable = () => true

  it("emits a warning when stable prompt is under the opus/haiku 4096-token minimum", () => {
    const out = renderPreflight(visualReport, {
      isTTY: true,
      yes: true,
      isPlaywrightResolvable: resolvable,
      stablePromptInfo: { tokens: 2000, model: "opus" },
    })
    const stripped = stripAnsi(out)
    expect(stripped).toContain("Caching skipped")
    expect(stripped).toContain("~2000 tokens")
    expect(stripped).toContain("4096-token minimum")
  })

  it("emits a warning when sonnet stable prompt is under 2048-token minimum", () => {
    const out = renderPreflight(visualReport, {
      isTTY: true,
      yes: true,
      isPlaywrightResolvable: resolvable,
      stablePromptInfo: { tokens: 1000, model: "claude-sonnet-4-6" },
    })
    const stripped = stripAnsi(out)
    expect(stripped).toContain("Caching skipped")
    expect(stripped).toContain("2048-token minimum")
  })

  it("omits the warning when stable prompt meets the threshold", () => {
    const out = renderPreflight(visualReport, {
      isTTY: true,
      yes: true,
      isPlaywrightResolvable: resolvable,
      stablePromptInfo: { tokens: 5000, model: "opus" },
    })
    const stripped = stripAnsi(out)
    expect(stripped).not.toContain("Caching skipped")
  })

  it("omits the warning when stablePromptInfo is absent", () => {
    const out = renderPreflight(visualReport, {
      isTTY: true,
      yes: true,
      isPlaywrightResolvable: resolvable,
    })
    const stripped = stripAnsi(out)
    expect(stripped).not.toContain("Caching skipped")
  })
})
