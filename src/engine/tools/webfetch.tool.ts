import { lookup } from "node:dns/promises"
import { z } from "zod"
import { defineTool, type ToolFactoryContext } from "./types.js"

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_FETCH_BYTES = 500_000
const MAX_OUTPUT_CHARS = 100_000
const MAX_REDIRECTS = 5

/**
 * Match a hostname against the network allowlist. An empty allowlist means
 * unrestricted (the "*" convention from settings). Entries match the host
 * exactly or as a parent domain (`example.com` allows `docs.example.com`).
 */
const isHostAllowed = (host: string, allowlist: readonly string[]): boolean => {
  if (allowlist.length === 0) return true
  const h = host.toLowerCase()
  return allowlist.some((entry) => {
    const e = entry.toLowerCase()
    return h === e || h.endsWith(`.${e}`)
  })
}

/**
 * Block loopback/private/link-local addresses to limit SSRF — these are never
 * valid research targets and must be refused even when the allowlist is open.
 * Applied to both the request hostname AND every resolved IP, so a public
 * hostname whose DNS points at 127.0.0.1 / 169.254.169.254 is still blocked.
 */
const isBlockedHost = (host: string): boolean => {
  let h = host.toLowerCase().replace(/^\[|\]$/g, "")
  if (h === "localhost" || h.endsWith(".localhost") || h === "::1") return true
  h = h.replace(/^::ffff:/, "") // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    if (a === 0 || a === 127 || a === 10) return true
    if (a === 169 && b === 254) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
  }
  if (/^fe80/.test(h) || /^f[cd][0-9a-f]{2}/.test(h)) return true
  return false
}

/**
 * Validate a (redirect) target before fetching it: protocol, the hostname
 * block/allowlist, AND every IP the hostname resolves to. Re-run for each
 * redirect hop so a redirect cannot escape the allowlist or reach a private IP.
 */
const assertUrlSafe = async (url: URL, allowlist: readonly string[]): Promise<void> => {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http(s) URLs are supported; got '${url.protocol}'.`)
  }
  if (isBlockedHost(url.hostname)) {
    throw new Error(`Host '${url.hostname}' is blocked (loopback/private address).`)
  }
  if (!isHostAllowed(url.hostname, allowlist)) {
    throw new Error(`Host '${url.hostname}' is not in the network allowlist.`)
  }
  let resolved: Array<{ address: string }>
  try {
    resolved = await lookup(url.hostname, { all: true })
  } catch {
    throw new Error(`Could not resolve host '${url.hostname}'.`)
  }
  for (const { address } of resolved) {
    if (isBlockedHost(address)) {
      throw new Error(`Host '${url.hostname}' resolves to a blocked address (${address}).`)
    }
  }
}

/** Convert HTML to readable text — block elements become newlines, tags drop. */
const htmlToText = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|ul|ol|table|pre|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()

const boundedText = (raw: string, contentType: string): string => {
  const bounded = raw.length > MAX_FETCH_BYTES ? raw.slice(0, MAX_FETCH_BYTES) : raw
  const text = /html/i.test(contentType) ? htmlToText(bounded) : bounded
  return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n…[truncated]` : text
}

/**
 * Fetch a URL and return its text content (HTML converted to text). Network
 * access is in-process (not greywall), so the tool enforces the allowlist and
 * SSRF protections itself: redirects are followed MANUALLY and each hop is
 * re-validated (allowlist + private-IP block + DNS resolution), so neither a
 * redirect nor a DNS record pointing at an internal address can bypass the
 * checks.
 */
export const makeWebFetchTool = (ctx: ToolFactoryContext) =>
  defineTool({
    name: "WebFetch",
    description:
      "Fetch a URL and return its text content (HTML is converted to text). " +
      "Only hosts permitted by the network allowlist are reachable.",
    input_schema: z.object({
      url: z.string().describe("Absolute http(s) URL to fetch."),
      prompt: z.string().optional().describe("What to look for (advisory; the full text is returned)."),
    }),
    execute: async (input, toolCtx) => {
      let current: URL
      try {
        current = new URL(input.url)
      } catch {
        throw new Error(`Invalid URL: ${input.url}`)
      }

      const controller = new AbortController()
      const onAbort = (): void => controller.abort()
      toolCtx.abort.addEventListener("abort", onAbort, { once: true })
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
      try {
        for (let hop = 0; ; hop++) {
          if (hop > MAX_REDIRECTS) {
            throw new Error(`Too many redirects (>${MAX_REDIRECTS}) fetching ${input.url}.`)
          }
          await assertUrlSafe(current, ctx.networkAllowlist)
          const res = await fetch(current, {
            signal: controller.signal,
            redirect: "manual",
            headers: { "user-agent": "ridgeline-research/1.0", accept: "text/html,text/plain,*/*" },
          })
          if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get("location")
            if (!location) throw new Error(`Redirect (${res.status}) with no Location from ${current.href}.`)
            current = new URL(location, current) // re-validated at the top of the next hop
            continue
          }
          if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${current.href}.`)
          return boundedText(await res.text(), res.headers.get("content-type") ?? "")
        }
      } finally {
        clearTimeout(timer)
        toolCtx.abort.removeEventListener("abort", onAbort)
      }
    },
  })
