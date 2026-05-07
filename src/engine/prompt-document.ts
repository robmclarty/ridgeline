/**
 * Structured prompt builder that separates trusted instructions from injected data.
 *
 * - instruction(heading, content): Ridgeline's own directives — rendered as bare markdown.
 * - data(heading, content): User-authored or generated content — wrapped with a data marker.
 * - dataFenced(heading, content, lang): Like data(), but inside a typed code fence.
 */

type SectionRole = "instruction" | "data" | "data-fenced"

type Section = {
  role: SectionRole
  heading: string
  content: string
  lang?: string
}

export interface PromptDocument {
  /** Trusted instruction section — rendered as bare markdown. */
  instruction(heading: string, content: string): PromptDocument
  /** Injected/untrusted data section — marked with a data role comment. */
  data(heading: string, content: string): PromptDocument
  /** Injected data inside a typed code fence (e.g. lang = "diff"). */
  dataFenced(heading: string, content: string, lang: string): PromptDocument
  /** Return the internal section array for test assertions. */
  inspect(): ReadonlyArray<Readonly<Section>>
  /** Produce the final prompt string. */
  render(): string
}

const renderSection = (s: Section): string => {
  const heading = `## ${s.heading}`
  switch (s.role) {
    case "instruction":
      return `${heading}\n\n${s.content}`
    case "data":
      return `${heading}\n\n<!-- role: data -->\n${s.content}`
    case "data-fenced":
      return `${heading}\n\n<!-- role: data -->\n\`\`\`${s.lang}\n${s.content}\n\`\`\``
  }
}

export const createPromptDocument = (): PromptDocument => {
  const sections: Section[] = []

  const doc: PromptDocument = {
    instruction(heading, content) {
      sections.push({ role: "instruction", heading, content })
      return doc
    },
    data(heading, content) {
      sections.push({ role: "data", heading, content })
      return doc
    },
    dataFenced(heading, content, lang) {
      sections.push({ role: "data-fenced", heading, content, lang })
      return doc
    },
    inspect() {
      return sections
    },
    render() {
      return sections.map(renderSection).join("\n\n")
    },
  }

  return doc
}
