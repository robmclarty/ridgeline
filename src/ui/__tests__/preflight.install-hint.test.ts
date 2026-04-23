import { describe, expect, it } from "vitest"
import type { DetectionReport } from "../../engine/detect"
import { renderPreflight } from "../preflight"
import { stripAnsi } from "../color"

const visualReport: DetectionReport = {
  projectType: "web",
  isVisualSurface: true,
  detectedDeps: ["react", "vite"],
  hasDesignMd: true,
  hasAssetDir: false,
  suggestedSensors: ["playwright", "vision", "a11y", "contrast"],
  suggestedEnsembleSize: 2,
}

const nonVisualReport: DetectionReport = {
  projectType: "node",
  isVisualSurface: false,
  detectedDeps: [],
  hasDesignMd: false,
  hasAssetDir: false,
  suggestedSensors: [],
  suggestedEnsembleSize: 2,
}

describe("preflight playwright install-hint", () => {
  it("renders the install hint when visual surface detected and playwright unresolvable", () => {
    const out = renderPreflight(visualReport, {
      isTTY: false,
      yes: false,
      isPlaywrightResolvable: () => false,
    })
    const stripped = stripAnsi(out)
    expect(stripped).toContain("visual surface detected")
    expect(stripped).toContain("npm install --save-dev playwright && npx playwright install chromium")
  })

  it("emits the hint on a single line so copy-paste works", () => {
    const out = renderPreflight(visualReport, {
      isTTY: false,
      yes: false,
      isPlaywrightResolvable: () => false,
    })
    const stripped = stripAnsi(out)
    const hintLine = stripped.split("\n").find((line) => line.includes("npm install"))
    expect(hintLine).toBeDefined()
    expect(hintLine).toContain("npm install --save-dev playwright && npx playwright install chromium")
  })

  it("omits the hint when playwright is resolvable", () => {
    const out = renderPreflight(visualReport, {
      isTTY: false,
      yes: false,
      isPlaywrightResolvable: () => true,
    })
    const stripped = stripAnsi(out)
    expect(stripped).not.toContain("visual surface detected")
    expect(stripped).not.toContain("npm install --save-dev playwright")
  })

  it("omits the hint when no visual surface is detected", () => {
    const out = renderPreflight(nonVisualReport, {
      isTTY: false,
      yes: false,
      isPlaywrightResolvable: () => false,
    })
    const stripped = stripAnsi(out)
    expect(stripped).not.toContain("visual surface detected")
    expect(stripped).not.toContain("npm install --save-dev playwright")
  })
})
