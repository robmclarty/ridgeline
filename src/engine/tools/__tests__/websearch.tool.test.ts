import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { ToolExecContext } from "fascicle"
import { makeWebSearchTool } from "../websearch.tool.js"
import type { ToolFactoryContext, WebSearchBackends } from "../types.js"

const TOOL_CTX: ToolExecContext = {
  abort: new AbortController().signal,
  tool_call_id: "t",
  step_index: 0,
}

const ctxWith = (search?: WebSearchBackends): ToolFactoryContext => ({
  cwd: "/work",
  sandboxProvider: null,
  sandboxMode: "off",
  sandboxExtras: { writePaths: [], readPaths: [], profiles: [], networkAllowlist: [] },
  networkAllowlist: [],
  search,
})

const textResponse = (body: string, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  statusText: ok ? "OK" : "ERR",
  text: async () => body,
})

let fetchMock: ReturnType<typeof vi.fn>

const run = async (tool: ReturnType<typeof makeWebSearchTool>, input: unknown): Promise<string> =>
  String(await tool.execute(tool.input_schema.parse(input), TOOL_CTX))

describe("WebSearch tool", () => {
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("queries SearXNG JSON and formats results", async () => {
    fetchMock.mockResolvedValue(
      textResponse(JSON.stringify({ results: [{ title: "Doc", url: "https://docs.rs/x", content: "a crate" }] })),
    )
    const out = await run(makeWebSearchTool(ctxWith({ searxngUrl: "http://localhost:8888" })), { query: "rust x" })
    expect(out).toContain("Doc")
    expect(out).toContain("https://docs.rs/x")
    expect(out).toContain("a crate")
    const calledUrl = fetchMock.mock.calls[0]![0].toString()
    expect(calledUrl).toContain("/search")
    expect(calledUrl).toContain("format=json")
  })

  it("parses DuckDuckGo HTML and unwraps redirect URLs", async () => {
    // Build the redirect target via encodeURIComponent (avoids %xx tokens in source).
    const target = "https://example.com/page"
    const html =
      `<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(target)}&rut=z">Example Title</a>` +
      '<a class="result__snippet" href="x">A useful snippet</a>'
    fetchMock.mockResolvedValue(textResponse(html))
    const out = await run(makeWebSearchTool(ctxWith({ duckduckgo: true })), { query: "example" })
    expect(out).toContain("Example Title")
    expect(out).toContain(target)
    expect(out).toContain("A useful snippet")
    expect(fetchMock.mock.calls[0]![0]).toBe("https://html.duckduckgo.com/html/")
  })

  it("falls back from SearXNG to DuckDuckGo when SearXNG returns non-JSON", async () => {
    fetchMock
      .mockResolvedValueOnce(textResponse("<html>403 Forbidden</html>")) // SearXNG (JSON disabled)
      .mockResolvedValueOnce(
        textResponse('<a class="result__a" href="https://fallback.test/">FB</a><a class="result__snippet">snip</a>'),
      )
    const out = await run(
      makeWebSearchTool(ctxWith({ searxngUrl: "http://localhost:8888", duckduckgo: true })),
      { query: "q" },
    )
    expect(out).toContain("https://fallback.test/")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("returns a clear message when a backend yields no results", async () => {
    fetchMock.mockResolvedValue(textResponse(JSON.stringify({ results: [] })))
    const out = await run(makeWebSearchTool(ctxWith({ searxngUrl: "http://localhost:8888" })), { query: "nothing" })
    expect(out).toBe("No results found for: nothing")
  })

  it("throws when no backend is configured", async () => {
    await expect(run(makeWebSearchTool(ctxWith()), { query: "x" })).rejects.toThrow(/not configured/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
