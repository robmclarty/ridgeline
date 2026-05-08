import { describe, it, expect } from "vitest"
import { createPromptDocument, PromptDocument } from "../../prompt-document.js"

describe("PromptDocument", () => {
  it("renders an instruction section as bare markdown", () => {
    const doc = createPromptDocument()
    doc.instruction("Check Command", "Run npm test after changes.")
    expect(doc.render()).toBe("## Check Command\n\nRun npm test after changes.")
  })

  it("renders a data section with role marker", () => {
    const doc = createPromptDocument()
    doc.data("constraints.md", "Use TypeScript strict mode.")
    expect(doc.render()).toBe(
      "## constraints.md\n\n<!-- role: data -->\nUse TypeScript strict mode.",
    )
  })

  it("renders a data-fenced section with lang tag", () => {
    const doc = createPromptDocument()
    doc.dataFenced("Git Diff", "+added line", "diff")
    expect(doc.render()).toBe(
      "## Git Diff\n\n<!-- role: data -->\n```diff\n+added line\n```",
    )
  })

  it("joins multiple sections with double newlines", () => {
    const doc = createPromptDocument()
    doc.instruction("Heading A", "Content A")
    doc.data("Heading B", "Content B")
    const rendered = doc.render()
    expect(rendered).toBe(
      "## Heading A\n\nContent A\n\n## Heading B\n\n<!-- role: data -->\nContent B",
    )
  })

  it("returns empty string for an empty document", () => {
    expect(createPromptDocument().render()).toBe("")
  })

  it("supports fluent chaining", () => {
    const rendered = createPromptDocument()
      .instruction("A", "1")
      .data("B", "2")
      .dataFenced("C", "3", "json")
      .render()

    expect(rendered).toContain("## A\n\n1")
    expect(rendered).toContain("## B\n\n<!-- role: data -->\n2")
    expect(rendered).toContain("## C\n\n<!-- role: data -->\n```json\n3\n```")
  })

  it("inspect() returns structured sections in order", () => {
    const doc = createPromptDocument()
      .instruction("A", "1")
      .data("B", "2")
      .dataFenced("C", "3", "diff")

    const sections = doc.inspect()
    expect(sections).toHaveLength(3)
    expect(sections[0]).toEqual({ role: "instruction", heading: "A", content: "1" })
    expect(sections[1]).toEqual({ role: "data", heading: "B", content: "2" })
    expect(sections[2]).toEqual({ role: "data-fenced", heading: "C", content: "3", lang: "diff" })
  })

  it("inspect() returns a read-only view", () => {
    const doc = createPromptDocument().instruction("A", "1")
    const sections = doc.inspect()
    // TypeScript prevents mutation at compile time; verify the array is a snapshot
    expect(sections).toHaveLength(1)
    doc.data("B", "2")
    // inspect() returns the live array — new section is visible
    expect(doc.inspect()).toHaveLength(2)
  })
})
