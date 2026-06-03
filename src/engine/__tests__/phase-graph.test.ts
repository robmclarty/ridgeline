import { describe, it, expect } from "vitest"
import { buildPhaseGraph, validateGraph, getReadyPhases, hasParallelism, chunkWave } from "../phase-graph.js"
import { PhaseInfo } from "../../types.js"

const makePhase = (id: string, index: number, dependsOn: string[] = []): PhaseInfo => ({
  id,
  index,
  slug: id.replace(/^\d+-/, ""),
  filename: `${id}.md`,
  filepath: `/tmp/phases/${id}.md`,
  dependsOn,
})

describe("buildPhaseGraph", () => {
  it("creates implicit sequential dependencies when no dependsOn declared", () => {
    const phases = [makePhase("01-scaffold", 1), makePhase("02-api", 2), makePhase("03-ui", 3)]
    const graph = buildPhaseGraph(phases)

    expect(graph.dependencies.get("01-scaffold")!.size).toBe(0)
    expect([...graph.dependencies.get("02-api")!]).toEqual(["01-scaffold"])
    expect([...graph.dependencies.get("03-ui")!]).toEqual(["02-api"])
  })

  it("uses explicit dependsOn when declared", () => {
    const phases = [
      makePhase("01-scaffold", 1),
      makePhase("02-api", 2, ["01-scaffold"]),
      makePhase("03-ui", 3, ["01-scaffold"]),
    ]
    const graph = buildPhaseGraph(phases)

    // Both 02 and 03 depend only on 01, enabling parallelism
    expect([...graph.dependencies.get("02-api")!]).toEqual(["01-scaffold"])
    expect([...graph.dependencies.get("03-ui")!]).toEqual(["01-scaffold"])
  })
})

describe("validateGraph", () => {
  it("passes for a valid sequential graph", () => {
    const phases = [makePhase("01-scaffold", 1), makePhase("02-api", 2)]
    const graph = buildPhaseGraph(phases)
    expect(() => validateGraph(graph)).not.toThrow()
  })

  it("passes for a valid parallel graph", () => {
    const phases = [
      makePhase("01-scaffold", 1),
      makePhase("02-api", 2, ["01-scaffold"]),
      makePhase("03-ui", 3, ["01-scaffold"]),
      makePhase("04-integrate", 4, ["02-api", "03-ui"]),
    ]
    const graph = buildPhaseGraph(phases)
    expect(() => validateGraph(graph)).not.toThrow()
  })

  it("throws on missing dependency", () => {
    const phases = [makePhase("01-scaffold", 1, ["00-nonexistent"])]
    const graph = buildPhaseGraph(phases)
    expect(() => validateGraph(graph)).toThrow(/unknown phase "00-nonexistent"/)
  })

  it("throws on dependency cycle", () => {
    const phases = [
      makePhase("01-a", 1, ["02-b"]),
      makePhase("02-b", 2, ["01-a"]),
    ]
    const graph = buildPhaseGraph(phases)
    expect(() => validateGraph(graph)).toThrow(/cycle/)
  })
})

describe("getReadyPhases", () => {
  it("returns first phase when nothing is completed", () => {
    const phases = [makePhase("01-scaffold", 1), makePhase("02-api", 2)]
    const graph = buildPhaseGraph(phases)
    const ready = getReadyPhases(graph, new Set())

    expect(ready.map((p) => p.id)).toEqual(["01-scaffold"])
  })

  it("returns parallel phases when their shared dependency is complete", () => {
    const phases = [
      makePhase("01-scaffold", 1),
      makePhase("02-api", 2, ["01-scaffold"]),
      makePhase("03-ui", 3, ["01-scaffold"]),
    ]
    const graph = buildPhaseGraph(phases)
    const ready = getReadyPhases(graph, new Set(["01-scaffold"]))

    expect(ready.map((p) => p.id).sort()).toEqual(["02-api", "03-ui"])
  })

  it("returns convergence phase when all dependencies are complete", () => {
    const phases = [
      makePhase("01-scaffold", 1),
      makePhase("02-api", 2, ["01-scaffold"]),
      makePhase("03-ui", 3, ["01-scaffold"]),
      makePhase("04-integrate", 4, ["02-api", "03-ui"]),
    ]
    const graph = buildPhaseGraph(phases)
    const ready = getReadyPhases(graph, new Set(["01-scaffold", "02-api", "03-ui"]))

    expect(ready.map((p) => p.id)).toEqual(["04-integrate"])
  })

  it("does not return convergence phase when only some dependencies are complete", () => {
    const phases = [
      makePhase("01-scaffold", 1),
      makePhase("02-api", 2, ["01-scaffold"]),
      makePhase("03-ui", 3, ["01-scaffold"]),
      makePhase("04-integrate", 4, ["02-api", "03-ui"]),
    ]
    const graph = buildPhaseGraph(phases)
    const ready = getReadyPhases(graph, new Set(["01-scaffold", "02-api"]))

    // Only 03-ui is ready, not 04-integrate
    expect(ready.map((p) => p.id)).toEqual(["03-ui"])
  })

  it("returns empty when all phases are complete", () => {
    const phases = [makePhase("01-scaffold", 1)]
    const graph = buildPhaseGraph(phases)
    const ready = getReadyPhases(graph, new Set(["01-scaffold"]))

    expect(ready).toEqual([])
  })
})

describe("hasParallelism", () => {
  it("returns false for fully sequential phases", () => {
    const phases = [makePhase("01-scaffold", 1), makePhase("02-api", 2), makePhase("03-ui", 3)]
    const graph = buildPhaseGraph(phases)
    expect(hasParallelism(graph)).toBe(false)
  })

  it("returns true when phases can run in parallel", () => {
    const phases = [
      makePhase("01-scaffold", 1),
      makePhase("02-api", 2, ["01-scaffold"]),
      makePhase("03-ui", 3, ["01-scaffold"]),
    ]
    const graph = buildPhaseGraph(phases)
    expect(hasParallelism(graph)).toBe(true)
  })
})

describe("chunkWave", () => {
  const a = makePhase("a", 0)
  const b = makePhase("b", 1)
  const c = makePhase("c", 2)
  const d = makePhase("d", 3)

  it("returns the wave unchanged when maxConcurrency is Infinity", () => {
    expect(chunkWave([a, b, c], Infinity)).toEqual([[a, b, c]])
  })

  it("returns the wave unchanged when maxConcurrency >= wave length", () => {
    expect(chunkWave([a, b], 5)).toEqual([[a, b]])
    expect(chunkWave([a, b], 2)).toEqual([[a, b]])
  })

  it("chunks a 3-phase wave into [2, 1] when maxConcurrency=2", () => {
    expect(chunkWave([a, b, c], 2)).toEqual([[a, b], [c]])
  })

  it("chunks a 4-phase wave into [2, 2] when maxConcurrency=2", () => {
    expect(chunkWave([a, b, c, d], 2)).toEqual([[a, b], [c, d]])
  })

  it("chunks into singletons when maxConcurrency=1 (effectively serial)", () => {
    expect(chunkWave([a, b, c], 1)).toEqual([[a], [b], [c]])
  })

  it("preserves order across chunks", () => {
    const result = chunkWave([a, b, c, d], 3)
    expect(result.flat().map((p) => p.id)).toEqual(["a", "b", "c", "d"])
  })

  it("handles an empty wave", () => {
    expect(chunkWave([], 2)).toEqual([[]])
  })
})
