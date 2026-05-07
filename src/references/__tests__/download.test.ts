import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup.js"
import {
  downloadReference,
  parseReferenceFinderOutput,
  writeVisualAnchorsMd,
  type DownloadedReference,
} from "../download.js"

describe("parseReferenceFinderOutput", () => {
  it("parses bare JSON", () => {
    const raw = JSON.stringify({
      references: [
        { name: "Foo", anchor_quality: "warm palette", image_urls: ["https://a/1.png", "https://a/2.jpg"] },
      ],
    })
    const out = parseReferenceFinderOutput(raw)
    expect(out.references).toHaveLength(1)
    expect(out.references[0].name).toBe("Foo")
    expect(out.references[0].image_urls).toEqual(["https://a/1.png", "https://a/2.jpg"])
  })

  it("parses fenced JSON with leading log lines", () => {
    const raw = [
      "Searching for references...",
      "Found 2 sources.",
      "",
      "```json",
      JSON.stringify({ references: [{ name: "Bar", anchor_quality: "x", image_urls: ["https://b/1.png"] }] }),
      "```",
    ].join("\n")
    const out = parseReferenceFinderOutput(raw)
    expect(out.references).toHaveLength(1)
    expect(out.references[0].name).toBe("Bar")
  })

  it("parses output after a divider line", () => {
    const raw = [
      "log line one",
      "---",
      JSON.stringify({ references: [{ name: "Baz", anchor_quality: "y", image_urls: [] }] }),
    ].join("\n")
    const out = parseReferenceFinderOutput(raw)
    expect(out.references).toHaveLength(1)
    expect(out.references[0].image_urls).toEqual([])
  })

  it("returns empty array for unparseable output", () => {
    expect(parseReferenceFinderOutput("not json at all").references).toEqual([])
  })

  it("filters out entries without a name", () => {
    const raw = JSON.stringify({
      references: [
        { anchor_quality: "no name", image_urls: [] },
        { name: "Valid", anchor_quality: "ok", image_urls: ["https://x/1.png"] },
      ],
    })
    const out = parseReferenceFinderOutput(raw)
    expect(out.references).toHaveLength(1)
    expect(out.references[0].name).toBe("Valid")
  })
})

describe("downloadReference", () => {
  let tmpDir: string
  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it("downloads urls via the injected fetcher and writes per-index files", async () => {
    const result = await downloadReference(
      tmpDir,
      {
        name: "FFT",
        anchor_quality: "warm",
        image_urls: ["https://example.test/a.png", "https://example.test/b.jpg"],
      },
      {
        fetcher: async (url) => ({
          buffer: Buffer.from(`stub-${url}`),
          contentType: url.endsWith(".png") ? "image/png" : "image/jpeg",
        }),
      },
    )
    expect(result.slug).toBe("fft")
    expect(result.files).toHaveLength(2)
    expect(result.files[0]).toMatch(/01\.png$/)
    expect(result.files[1]).toMatch(/02\.jpg$/)
    expect(fs.readFileSync(result.files[0], "utf-8")).toBe("stub-https://example.test/a.png")
    expect(result.failures).toEqual([])
  })

  it("records failures without aborting the whole reference", async () => {
    let callIndex = 0
    const result = await downloadReference(
      tmpDir,
      { name: "Mixed", anchor_quality: "x", image_urls: ["https://ok.test/1.png", "https://bad.test/2.png"] },
      {
        fetcher: async () => {
          callIndex++
          if (callIndex === 2) throw new Error("HTTP 404")
          return { buffer: Buffer.from("ok"), contentType: "image/png" }
        },
      },
    )
    expect(result.files).toHaveLength(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toContain("HTTP 404")
  })

  it("infers svg extension from content type", async () => {
    const result = await downloadReference(
      tmpDir,
      { name: "Vec", anchor_quality: "x", image_urls: ["https://x.test/no-ext"] },
      {
        fetcher: async () => ({ buffer: Buffer.from("<svg/>"), contentType: "image/svg+xml" }),
      },
    )
    expect(result.files[0]).toMatch(/01\.svg$/)
  })
})

describe("writeVisualAnchorsMd", () => {
  let tmpDir: string
  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it("writes a sectioned markdown index of references", () => {
    fs.mkdirSync(path.join(tmpDir, "fft"), { recursive: true })
    const fftFile = path.join(tmpDir, "fft", "01.png")
    fs.writeFileSync(fftFile, "x")

    const result: DownloadedReference[] = [
      { name: "Final Fantasy Tactics", slug: "fft", anchor_quality: "warm parchment", files: [fftFile], failures: [] },
      { name: "EXAPUNKS", slug: "exapunks", anchor_quality: "terminal restraint", files: [], failures: ["https://x/y: HTTP 404"] },
    ]
    const outPath = writeVisualAnchorsMd(tmpDir, result)
    expect(outPath).toBe(path.join(tmpDir, "visual-anchors.md"))
    const content = fs.readFileSync(outPath, "utf-8")
    expect(content).toContain("# Visual Anchors")
    expect(content).toContain("## Final Fantasy Tactics")
    expect(content).toContain("warm parchment")
    expect(content).toContain("`fft/01.png`")
    expect(content).toContain("## EXAPUNKS")
    expect(content).toContain("HTTP 404")
  })
})
