type SectionRole = "instruction" | "data" | "data-fenced"

type Section = {
  role: SectionRole
  heading: string
  content: string
  lang?: string
}

export interface AtomPromptDocument {
  instruction(heading: string, content: string): AtomPromptDocument
  data(heading: string, content: string): AtomPromptDocument
  dataFenced(heading: string, content: string, lang: string): AtomPromptDocument
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

export const createAtomPromptDocument = (): AtomPromptDocument => {
  const sections: Section[] = []
  const doc: AtomPromptDocument = {
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
    render() {
      return sections.map(renderSection).join("\n\n")
    },
  }
  return doc
}
