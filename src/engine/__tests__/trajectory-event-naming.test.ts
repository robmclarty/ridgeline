import { describe, expect, it } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"

/**
 * AC13 — ridgeline-emitted trajectory event-type identifiers must follow a
 * stable naming convention. Fascicle-emitted events retain snake_case as
 * fascicle emits them; on-disk ridgeline event types
 * (`TrajectoryEntry["type"]` in `src/types.ts`) preserve their pre-migration
 * snake_case form for file-format stability with fascicle-viewer and
 * external `.jsonl` consumers. In-process `ctx.emit({ <key>: ... })`
 * payloads in `src/engine/{flows,atoms,composites,adapters}/` follow the
 * same `<area>_event` snake_case convention so the boundary between
 * fascicle's stream and ridgeline's translated on-disk shape is internally
 * consistent.
 *
 * This test scans those directories for `ctx.emit({ key: ... })` sites and
 * asserts every key is either:
 *
 * - the `<word>_event` snake_case form (the established ridgeline-side
 *   convention for in-process composite diagnostics), or
 * - alphanumeric camelCase (legitimate for non-event payload keys).
 *
 * Anything that deviates (kebab-case, SCREAMING_SNAKE, dotted) is flagged
 * as a new style introduction and fails the test.
 */

const SUBSTRATE_ROOTS = [
  "src/engine/atoms",
  "src/engine/composites",
  "src/engine/flows",
  "src/engine/adapters",
]

const walkTs = (root: string): readonly string[] => {
  if (!fs.existsSync(root)) return []
  const out: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "__fixtures__") continue
        stack.push(full)
        continue
      }
      if (entry.isFile() && full.endsWith(".ts")) out.push(full)
    }
  }
  return out
}

const EMIT_KEY_RE = /ctx\.emit\(\s*\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g

const SNAKE_EVENT_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*_event$/
const CAMEL_RE = /^[a-z][a-zA-Z0-9]*$/

describe("AC13 — trajectory event-type naming convention", () => {
  it("every ctx.emit key in the substrate follows the established snake_case `<area>_event` convention or camelCase", () => {
    const files: string[] = []
    for (const root of SUBSTRATE_ROOTS) files.push(...walkTs(root))
    expect(files.length).toBeGreaterThan(0)

    const violations: string[] = []
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8")
      EMIT_KEY_RE.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = EMIT_KEY_RE.exec(src)) !== null) {
        const key = match[1]
        if (!SNAKE_EVENT_RE.test(key) && !CAMEL_RE.test(key)) {
          violations.push(`${file}: ctx.emit({ ${key}: ... }) — expected <area>_event snake_case or camelCase`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it("on-disk TrajectoryEntry['type'] union members are lowercase_with_underscores (preserves file-format stability)", () => {
    const src = fs.readFileSync(path.resolve("src/types.ts"), "utf8")
    const typeBlock = src.match(/export type TrajectoryEntry = \{\s*[^}]*?type:\s*([\s\S]*?)phaseId:/)
    expect(typeBlock).not.toBeNull()
    const literals = typeBlock![1].match(/"([a-zA-Z0-9_]+)"/g) ?? []
    expect(literals.length).toBeGreaterThan(0)
    for (const literal of literals) {
      const value = literal.slice(1, -1)
      expect(value).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/)
    }
  })
})
