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

export class PromptDocument {
  private sections: Section[] = []

  /** Trusted instruction section — rendered as bare markdown. */
  instruction(heading: string, content: string): this {
    this.sections.push({ role: "instruction", heading, content })
    return this
  }

  /** Injected/untrusted data section — marked with a data role comment. */
  data(heading: string, content: string): this {
    this.sections.push({ role: "data", heading, content })
    return this
  }

  /** Injected data inside a typed code fence (e.g. lang = "diff"). */
  dataFenced(heading: string, content: string, lang: string): this {
    this.sections.push({ role: "data-fenced", heading, content, lang })
    return this
  }

  /** Return the internal section array for test assertions. */
  inspect(): ReadonlyArray<Readonly<Section>> {
    return this.sections
  }

  /** Produce the final prompt string. */
  render(): string {
    return this.sections
      .map((s) => {
        const heading = `## ${s.heading}`
        switch (s.role) {
          case "instruction":
            return `${heading}\n\n${s.content}`
          case "data":
            return `${heading}\n\n<!-- role: data -->\n${s.content}`
          case "data-fenced":
            return `${heading}\n\n<!-- role: data -->\n\`\`\`${s.lang}\n${s.content}\n\`\`\``
        }
      })
      .join("\n\n")
  }
}
