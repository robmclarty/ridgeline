import { describe, expect, it } from "vitest"
import { formatShapeMd } from "../shape"

const baseShape = {
  projectName: "My App",
  intent: "ship a dashboard",
  scope: { size: "small", inScope: ["one"], outOfScope: ["two"] },
  solutionShape: "vanilla html",
  risksAndComplexities: ["risk one"],
  existingLandscape: {
    codebaseState: "empty",
    externalDependencies: [],
    dataStructures: [],
    relevantModules: [],
  },
  technicalPreferences: {
    errorHandling: "throw",
    performance: "n/a",
    security: "none",
    tradeoffs: "simple",
    style: "flat",
  },
}

describe("formatShapeMd — ## Runtime", () => {
  it("renders a Runtime section with the exact dev-server port line format when set", () => {
    const md = formatShapeMd({ ...baseShape, runtime: { devServerPort: 5173 } })
    expect(md).toContain("## Runtime")
    expect(md).toContain("- **Dev server port:** 5173")
  })

  it("places the Runtime section as the trailing heading", () => {
    const md = formatShapeMd({ ...baseShape, runtime: { devServerPort: 3000 } })
    const runtimeIdx = md.indexOf("## Runtime")
    const lastHeadingIdx = md.lastIndexOf("## ")
    expect(runtimeIdx).toBe(lastHeadingIdx)
  })

  it("omits the Runtime section entirely when runtime is absent", () => {
    const md = formatShapeMd(baseShape)
    expect(md).not.toContain("## Runtime")
  })

  it("omits the Runtime section when runtime is present but empty", () => {
    const md = formatShapeMd({ ...baseShape, runtime: {} })
    expect(md).not.toContain("## Runtime")
  })

  it("produces no YAML front matter", () => {
    const md = formatShapeMd({ ...baseShape, runtime: { devServerPort: 5173 } })
    expect(md.startsWith("---\n")).toBe(false)
  })
})
