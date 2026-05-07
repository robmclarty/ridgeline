import type {
  SpecialistStage,
  SpecialistVerdict,
  SpecialistSkeletonSpec,
  SpecialistSkeletonPlan,
  SpecialistSkeletonResearch,
} from "../types.js"

const FENCE_PATTERN = /```(?:json)?\s*\n?([\s\S]*?)```/g

const findJsonCandidates = (raw: string): string[] => {
  const candidates: string[] = []
  const trimmed = raw.trim()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    candidates.push(trimmed)
  }
  let match: RegExpExecArray | null
  while ((match = FENCE_PATTERN.exec(raw)) !== null) {
    candidates.push(match[1].trim())
  }
  return candidates
}

const safeParse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const asStringArray = (v: unknown): string[] | null => {
  if (!Array.isArray(v)) return null
  const out: string[] = []
  for (const item of v) {
    if (typeof item !== "string") return null
    out.push(item)
  }
  return out
}

const normalizeSpec = (obj: Record<string, unknown>): SpecialistSkeletonSpec | null => {
  const sectionOutline = asStringArray(obj.sectionOutline)
  const riskList = asStringArray(obj.riskList)
  if (!sectionOutline || !riskList) return null
  return { sectionOutline, riskList }
}

const normalizePlan = (obj: Record<string, unknown>): SpecialistSkeletonPlan | null => {
  const rawPhases = obj.phaseList
  if (!Array.isArray(rawPhases)) return null
  const phaseList: { id: string; slug: string }[] = []
  for (const item of rawPhases) {
    if (typeof item !== "object" || item === null) return null
    const entry = item as Record<string, unknown>
    if (typeof entry.id !== "string" || typeof entry.slug !== "string") return null
    phaseList.push({ id: entry.id, slug: entry.slug })
  }

  const rawGraph = obj.depGraph
  if (!Array.isArray(rawGraph)) return null
  const depGraph: [string, string][] = []
  for (const edge of rawGraph) {
    if (!Array.isArray(edge) || edge.length !== 2) return null
    const [a, b] = edge
    if (typeof a !== "string" || typeof b !== "string") return null
    depGraph.push([a, b])
  }

  return { phaseList, depGraph }
}

const normalizeResearch = (obj: Record<string, unknown>): SpecialistSkeletonResearch | null => {
  const findings = asStringArray(obj.findings)
  const openQuestions = asStringArray(obj.openQuestions)
  if (!findings || !openQuestions) return null
  return { findings, openQuestions }
}

const normalizeBy = (
  stage: SpecialistStage,
  obj: Record<string, unknown>,
): SpecialistVerdict["skeleton"] | null => {
  if (stage === "spec") return normalizeSpec(obj)
  if (stage === "plan") return normalizePlan(obj)
  return normalizeResearch(obj)
}

/**
 * Extract a stage-specific skeleton from raw specialist output.
 *
 * Accepts two shapes, in order:
 *   1. A top-level JSON object or fenced ```json block whose root contains
 *      a `_skeleton` field matching the stage schema.
 *   2. A top-level JSON object or fenced ```json block whose root directly
 *      matches the stage schema (used by researchers who append a skeleton
 *      block to their prose report).
 *
 * Returns null on missing block, malformed JSON, or schema mismatch.
 */
export const parseSpecialistVerdict = (
  stage: SpecialistStage,
  raw: string,
): SpecialistVerdict | null => {
  if (!raw || typeof raw !== "string") return null

  const candidates = findJsonCandidates(raw)
  for (const text of candidates) {
    const parsed = safeParse(text)
    if (!parsed || typeof parsed !== "object") continue
    const obj = parsed as Record<string, unknown>

    const nested = obj._skeleton
    if (nested && typeof nested === "object") {
      const skeleton = normalizeBy(stage, nested as Record<string, unknown>)
      if (skeleton) return { stage, skeleton } as SpecialistVerdict
    }

    const direct = normalizeBy(stage, obj)
    if (direct) return { stage, skeleton: direct } as SpecialistVerdict
  }
  return null
}

const trimStrings = (list: string[]): string[] => list.map((s) => s.trim())
const sortedCopy = (list: string[]): string[] => [...list].sort()

const equalOrderInsensitive = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false
  const left = sortedCopy(trimStrings(a))
  const right = sortedCopy(trimStrings(b))
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false
  }
  return true
}

const equalOrdered = (a: { id: string; slug: string }[], b: { id: string; slug: string }[]): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].id.trim() !== b[i].id.trim() || a[i].slug.trim() !== b[i].slug.trim()) return false
  }
  return true
}

const normalizeEdgeKey = (edge: [string, string]): string =>
  `${edge[0].trim()}->${edge[1].trim()}`

const equalEdges = (a: [string, string][], b: [string, string][]): boolean => {
  if (a.length !== b.length) return false
  const left = a.map(normalizeEdgeKey).sort()
  const right = b.map(normalizeEdgeKey).sort()
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false
  }
  return true
}

const skeletonsEqual = (a: SpecialistVerdict, b: SpecialistVerdict): boolean => {
  if (a.stage !== b.stage) return false
  if (a.stage === "spec" && b.stage === "spec") {
    return (
      equalOrderInsensitive(a.skeleton.sectionOutline, b.skeleton.sectionOutline) &&
      equalOrderInsensitive(a.skeleton.riskList, b.skeleton.riskList)
    )
  }
  if (a.stage === "plan" && b.stage === "plan") {
    return (
      equalOrdered(a.skeleton.phaseList, b.skeleton.phaseList) &&
      equalEdges(a.skeleton.depGraph, b.skeleton.depGraph)
    )
  }
  if (a.stage === "research" && b.stage === "research") {
    return (
      equalOrderInsensitive(a.skeleton.findings, b.skeleton.findings) &&
      equalOrderInsensitive(a.skeleton.openQuestions, b.skeleton.openQuestions)
    )
  }
  return false
}

/**
 * Agreement is defined strictly: every verdict must parse and every pair
 * must be equal under the stage's normalization rules.
 */
export const skeletonsAgree = (verdicts: (SpecialistVerdict | null)[]): boolean => {
  if (verdicts.length < 2) return false
  const first = verdicts[0]
  if (!first) return false
  for (let i = 1; i < verdicts.length; i++) {
    const next = verdicts[i]
    if (!next) return false
    if (!skeletonsEqual(first, next)) return false
  }
  return true
}
