import { z } from "zod"
import { defineTool, type ToolFactoryContext } from "./types.js"

const TIMEOUT_MS = 20_000
const DEFAULT_COUNT = 10
// DuckDuckGo's HTML endpoint rejects empty/bot user-agents.
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

type SearchResult = { title: string; url: string; snippet: string }

type FetchOpts = {
  abort: AbortSignal
  method?: string
  headers?: Record<string, string>
  body?: string
}

/**
 * Fetch a search BACKEND endpoint. The endpoint is trusted/configured (a fixed
 * public host or the user's own SearXNG, which is often localhost), so unlike
 * `WebFetch` it is NOT allowlist/SSRF-gated — the gating happens later when the
 * model retrieves a result URL via `WebFetch`.
 */
const fetchText = async (url: string | URL, opts: FetchOpts): Promise<string> => {
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  opts.abort.addEventListener("abort", onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: opts.headers,
      body: opts.body,
      signal: controller.signal,
      redirect: "follow",
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} from ${typeof url === "string" ? url : url.href}`)
    }
    return await res.text()
  } finally {
    clearTimeout(timer)
    opts.abort.removeEventListener("abort", onAbort)
  }
}

const stripTags = (html: string): string =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()

const searchSearxng = async (
  baseUrl: string,
  query: string,
  count: number,
  abort: AbortSignal,
): Promise<SearchResult[]> => {
  const url = new URL("/search", baseUrl)
  url.searchParams.set("q", query)
  url.searchParams.set("format", "json")
  const text = await fetchText(url, { abort })
  let json: { results?: Array<{ title?: string; url?: string; content?: string }> }
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error("SearXNG did not return JSON — enable the `json` format in its settings.yml.")
  }
  return (json.results ?? [])
    .map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.content ?? "" }))
    .filter((r) => r.url)
    .slice(0, count)
}

/** Unwrap DuckDuckGo's redirect href (`//duckduckgo.com/l/?uddg=<encoded>`). */
const resolveDdgUrl = (href: string): string => {
  const uddg = href.match(/[?&]uddg=([^&]+)/)
  if (uddg) return decodeURIComponent(uddg[1])
  if (href.startsWith("//")) return `https:${href}`
  return href
}

const parseDuckDuckGoHtml = (html: string, count: number): SearchResult[] => {
  const anchorRe = /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const snippetRe = /<a\b[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g
  const snippets: string[] = []
  for (let m = snippetRe.exec(html); m !== null; m = snippetRe.exec(html)) snippets.push(stripTags(m[1]))
  const results: SearchResult[] = []
  let i = 0
  for (let m = anchorRe.exec(html); m !== null && results.length < count; m = anchorRe.exec(html)) {
    const url = resolveDdgUrl(m[1])
    const title = stripTags(m[2])
    if (url) results.push({ title, url, snippet: snippets[i] ?? "" })
    i++
  }
  return results
}

const searchDuckDuckGo = async (query: string, count: number, abort: AbortSignal): Promise<SearchResult[]> => {
  const text = await fetchText("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": BROWSER_UA },
    body: new URLSearchParams({ q: query }).toString(),
    abort,
  })
  return parseDuckDuckGoHtml(text, count)
}

const formatResults = (results: SearchResult[], query: string): string =>
  results.length === 0
    ? `No results found for: ${query}`
    : results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n\n")

/**
 * Opt-in web search. Tries the configured backends in order — SearXNG (a
 * self-hosted metasearch instance) first, then the keyless DuckDuckGo HTML
 * endpoint if explicitly enabled. Returns title/url/snippet lines; the model
 * then retrieves chosen URLs through the SSRF-hardened `WebFetch`. A
 * provider-native search would be the preferred first backend, but fascicle
 * 0.5 cannot pass provider server-side tools, so it is deferred.
 */
export const makeWebSearchTool = (ctx: ToolFactoryContext) =>
  defineTool({
    name: "WebSearch",
    description:
      "Search the web for a query and return title/URL/snippet results. " +
      "Use WebFetch to retrieve the full content of a result.",
    input_schema: z.object({
      query: z.string().describe("The search query."),
      count: z.number().int().positive().max(25).optional().describe("Max results (default 10)."),
    }),
    execute: async (input, toolCtx) => {
      const count = input.count ?? DEFAULT_COUNT
      const backends: Array<() => Promise<SearchResult[]>> = []
      if (ctx.search?.searxngUrl) {
        backends.push(() => searchSearxng(ctx.search!.searxngUrl!, input.query, count, toolCtx.abort))
      }
      if (ctx.search?.duckduckgo) {
        backends.push(() => searchDuckDuckGo(input.query, count, toolCtx.abort))
      }
      if (backends.length === 0) {
        throw new Error("WebSearch is not configured (set search.url or search.duckduckgo in settings).")
      }

      let lastError: unknown
      for (const backend of backends) {
        try {
          const results = await backend()
          if (results.length > 0) return formatResults(results, input.query)
        } catch (err) {
          lastError = err
        }
      }
      if (lastError) throw lastError instanceof Error ? lastError : new Error(String(lastError))
      return `No results found for: ${input.query}`
    },
  })
