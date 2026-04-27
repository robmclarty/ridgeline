import * as fs from "node:fs"
import * as http from "node:http"
import * as https from "node:https"
import * as path from "node:path"
import { URL } from "node:url"

export interface ReferenceFinding {
  name: string
  anchor_quality: string
  image_urls: string[]
}

export interface DownloadedReference {
  name: string
  slug: string
  anchor_quality: string
  files: string[]
  failures: string[]
}

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_BYTES_PER_FILE = 5 * 1024 * 1024

const slugify = (input: string): string => {
  const cleaned = input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return cleaned.length > 0 ? cleaned : "ref"
}

const inferExtension = (urlPath: string, contentType: string | undefined): string => {
  const lowerPath = urlPath.toLowerCase()
  for (const ext of [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"]) {
    if (lowerPath.endsWith(ext)) return ext
  }
  if (contentType) {
    const ct = contentType.toLowerCase()
    if (ct.includes("image/png")) return ".png"
    if (ct.includes("image/jpeg") || ct.includes("image/jpg")) return ".jpg"
    if (ct.includes("image/gif")) return ".gif"
    if (ct.includes("image/webp")) return ".webp"
    if (ct.includes("image/svg")) return ".svg"
    if (ct.includes("image/avif")) return ".avif"
  }
  return ".bin"
}

interface DownloadOptions {
  timeoutMs?: number
  maxBytes?: number
  fetcher?: (url: string, opts: { timeoutMs: number; maxBytes: number }) => Promise<{ buffer: Buffer; contentType?: string }>
}

const fetchToBuffer = (
  url: string,
  opts: { timeoutMs: number; maxBytes: number },
): Promise<{ buffer: Buffer; contentType?: string }> =>
  new Promise((resolve, reject) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      reject(new Error(`invalid url: ${url}`))
      return
    }
    const lib = parsed.protocol === "http:" ? http : parsed.protocol === "https:" ? https : null
    if (!lib) {
      reject(new Error(`unsupported protocol: ${parsed.protocol}`))
      return
    }

    const req = lib.get(url, { timeout: opts.timeoutMs }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        fetchToBuffer(new URL(res.headers.location, url).href, opts).then(resolve, reject)
        return
      }
      if (status < 200 || status >= 300) {
        res.resume()
        reject(new Error(`HTTP ${status} for ${url}`))
        return
      }

      const chunks: Buffer[] = []
      let total = 0
      res.on("data", (chunk: Buffer) => {
        total += chunk.length
        if (total > opts.maxBytes) {
          res.destroy()
          reject(new Error(`exceeded ${opts.maxBytes} bytes for ${url}`))
          return
        }
        chunks.push(chunk)
      })
      res.on("end", () => {
        resolve({
          buffer: Buffer.concat(chunks),
          contentType: typeof res.headers["content-type"] === "string" ? res.headers["content-type"] : undefined,
        })
      })
      res.on("error", reject)
    })
    req.on("timeout", () => {
      req.destroy()
      reject(new Error(`timeout fetching ${url}`))
    })
    req.on("error", reject)
  })

export const downloadReference = async (
  outputRoot: string,
  ref: ReferenceFinding,
  opts: DownloadOptions = {},
): Promise<DownloadedReference> => {
  const slug = slugify(ref.name)
  const refDir = path.join(outputRoot, slug)
  fs.mkdirSync(refDir, { recursive: true })

  const fetcher = opts.fetcher ?? fetchToBuffer
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? MAX_BYTES_PER_FILE

  const files: string[] = []
  const failures: string[] = []

  for (let i = 0; i < ref.image_urls.length; i++) {
    const url = ref.image_urls[i]
    try {
      const { buffer, contentType } = await fetcher(url, { timeoutMs, maxBytes })
      const urlPath = (() => {
        try {
          return new URL(url).pathname
        } catch {
          return url
        }
      })()
      const ext = inferExtension(urlPath, contentType)
      const filename = `${String(i + 1).padStart(2, "0")}${ext}`
      const filepath = path.join(refDir, filename)
      fs.writeFileSync(filepath, buffer)
      files.push(filepath)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failures.push(`${url}: ${message}`)
    }
  }

  return { name: ref.name, slug, anchor_quality: ref.anchor_quality, files, failures }
}

export const writeVisualAnchorsMd = (
  outputRoot: string,
  results: DownloadedReference[],
): string => {
  const lines: string[] = ["# Visual Anchors", ""]
  lines.push(
    "Reference imagery for the design. Used by the visual-reviewer when scoring " +
      "taste fidelity, and by the direction-advisor when generating differentiated " +
      "visual options. Not committed to user-facing source — these files live under " +
      "`<buildDir>/references/` and are reference material only.",
  )
  lines.push("")

  for (const result of results) {
    lines.push(`## ${result.name}`)
    lines.push("")
    lines.push(result.anchor_quality)
    lines.push("")
    if (result.files.length > 0) {
      lines.push("**Files:**")
      for (const f of result.files) {
        lines.push(`- \`${path.relative(outputRoot, f)}\``)
      }
      lines.push("")
    }
    if (result.failures.length > 0) {
      lines.push("**Failures:**")
      for (const f of result.failures) {
        lines.push(`- ${f}`)
      }
      lines.push("")
    }
  }

  const outputPath = path.join(outputRoot, "visual-anchors.md")
  fs.writeFileSync(outputPath, lines.join("\n"))
  return outputPath
}

interface ParsedFinderOutput {
  references: ReferenceFinding[]
}

export const parseReferenceFinderOutput = (raw: string): ParsedFinderOutput => {
  const trimmed = raw.trim()
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  const candidate = fenceMatch ? fenceMatch[1] : trimmed

  const dividerSplit = candidate.split(/^---\s*$/m)
  const lastSection = dividerSplit[dividerSplit.length - 1]?.trim() ?? candidate

  const jsonMatch = lastSection.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return { references: [] }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { references?: unknown }
    if (!Array.isArray(parsed.references)) return { references: [] }
    const references: ReferenceFinding[] = []
    for (const entry of parsed.references) {
      if (!entry || typeof entry !== "object") continue
      const e = entry as Record<string, unknown>
      const name = typeof e.name === "string" ? e.name : null
      const anchor = typeof e.anchor_quality === "string" ? e.anchor_quality : ""
      const urls = Array.isArray(e.image_urls)
        ? e.image_urls.filter((u): u is string => typeof u === "string")
        : []
      if (!name) continue
      references.push({ name, anchor_quality: anchor, image_urls: urls })
    }
    return { references }
  } catch {
    return { references: [] }
  }
}
