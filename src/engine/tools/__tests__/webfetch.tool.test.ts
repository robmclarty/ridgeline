import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { ToolExecContext } from "fascicle"
import { makeWebFetchTool } from "../webfetch.tool.js"
import type { ToolFactoryContext } from "../types.js"

// DNS is mocked so tests are hermetic; default resolves to a public address.
const { lookupMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(async (_host: string) => [{ address: "93.184.216.34" }]),
}))
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }))

const TOOL_CTX: ToolExecContext = {
  abort: new AbortController().signal,
  tool_call_id: "t",
  step_index: 0,
}

const ctxWith = (networkAllowlist: readonly string[]): ToolFactoryContext => ({
  cwd: "/work",
  sandboxProvider: null,
  sandboxMode: "off",
  sandboxExtras: { writePaths: [], readPaths: [], profiles: [], networkAllowlist: [] },
  networkAllowlist,
})

type RespInit = { status?: number; ok?: boolean; headers?: Record<string, string>; body?: string }
const response = ({ status = 200, ok, headers = {}, body = "" }: RespInit) => ({
  ok: ok ?? (status >= 200 && status < 300),
  status,
  statusText: "X",
  headers: { get: (k: string): string | null => headers[k.toLowerCase()] ?? null },
  text: async () => body,
})

let fetchMock: ReturnType<typeof vi.fn>

const run = async (tool: ReturnType<typeof makeWebFetchTool>, input: unknown): Promise<string> =>
  String(await tool.execute(tool.input_schema.parse(input), TOOL_CTX))

describe("WebFetch tool", () => {
  beforeEach(() => {
    lookupMock.mockReset()
    lookupMock.mockResolvedValue([{ address: "93.184.216.34" }])
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("fetches an allowlisted host and returns HTML converted to text", async () => {
    fetchMock.mockResolvedValue(
      response({
        headers: { "content-type": "text/html" },
        body: "<html><body><h1>Title</h1><p>Hello <b>world</b></p><script>x()</script></body></html>",
      }),
    )
    const out = await run(makeWebFetchTool(ctxWith(["example.com"])), { url: "https://docs.example.com/guide" })
    expect(out).toContain("Title")
    expect(out).toContain("Hello world")
    expect(out).not.toContain("<h1>")
    expect(out).not.toContain("x()")
  })

  it("allows a parent-domain allowlist entry to cover subdomains", async () => {
    fetchMock.mockResolvedValue(response({ headers: { "content-type": "text/plain" }, body: "plain" }))
    const out = await run(makeWebFetchTool(ctxWith(["arxiv.org"])), { url: "https://export.arxiv.org/abs/1234" })
    expect(out).toBe("plain")
  })

  it("rejects a host outside the allowlist (before any fetch)", async () => {
    await expect(
      run(makeWebFetchTool(ctxWith(["example.com"])), { url: "https://evil.test/x" }),
    ).rejects.toThrow(/not in the network allowlist/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("blocks loopback/private hosts even when the allowlist is unrestricted", async () => {
    const tool = makeWebFetchTool(ctxWith([]))
    await expect(run(tool, { url: "http://localhost:8080/admin" })).rejects.toThrow(/blocked/)
    await expect(run(tool, { url: "http://127.0.0.1/" })).rejects.toThrow(/blocked/)
    await expect(run(tool, { url: "http://192.168.1.10/" })).rejects.toThrow(/blocked/)
    await expect(run(tool, { url: "http://169.254.169.254/latest/meta-data" })).rejects.toThrow(/blocked/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects non-http(s) protocols", async () => {
    await expect(run(makeWebFetchTool(ctxWith([])), { url: "file:///etc/passwd" })).rejects.toThrow(/http/)
  })

  it("throws on a non-OK HTTP status", async () => {
    fetchMock.mockResolvedValue(response({ status: 404, body: "nope" }))
    await expect(
      run(makeWebFetchTool(ctxWith(["example.com"])), { url: "https://example.com/missing" }),
    ).rejects.toThrow(/HTTP 404/)
  })

  it("does NOT follow a redirect to a blocked host (SSRF redirect bypass)", async () => {
    // First hop is allowlisted + resolves public, but redirects to the cloud metadata IP.
    fetchMock.mockResolvedValueOnce(
      response({ status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }),
    )
    await expect(run(makeWebFetchTool(ctxWith([])), { url: "https://example.com/start" })).rejects.toThrow(
      /blocked/,
    )
    // The second (malicious) hop must never be fetched.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("rejects a hostname whose DNS resolves to a private address (DNS rebinding)", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1" }])
    await expect(
      run(makeWebFetchTool(ctxWith(["example.com"])), { url: "https://docs.example.com/x" }),
    ).rejects.toThrow(/resolves to a blocked address/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("follows a safe redirect and returns the final body", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ status: 301, headers: { location: "https://docs.example.com/final" } }))
      .mockResolvedValueOnce(response({ headers: { "content-type": "text/plain" }, body: "final page" }))
    const out = await run(makeWebFetchTool(ctxWith(["example.com"])), { url: "https://docs.example.com/start" })
    expect(out).toBe("final page")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
