import * as fs from "node:fs"
import * as http from "node:http"
import * as path from "node:path"
import type { SensorAdapter, SensorFinding, SensorInput } from "./index"

const PLAYWRIGHT_INSTALL_HINT =
  "npm install --save-dev playwright && npx playwright install chromium"

const isPlaywrightResolvable = (): boolean => {
  try {
    require.resolve("playwright")
    return true
  } catch {
    return false
  }
}

const LAUNCH_TIMEOUT_MS = 10_000
const DEFAULT_PROBE_TIMEOUT_MS = 250
const DEFAULT_TOTAL_PROBE_MS = 1_000
const RUNTIME_BLOCK_RE = /^##\s+Runtime\s*$([\s\S]*?)(?=^##\s+|$(?![\r\n]))/m
const DEV_PORT_LINE_RE = /^\s*-\s*\*\*Dev server port:\*\*\s+(\d+)\s*$/m
const DEV_PORT_LINE_GLOBAL = new RegExp(DEV_PORT_LINE_RE.source, "gm")

export const PROBE_PORTS: readonly number[] = [5173, 3000, 8080, 4321]

type PortResult =
  | { source: "shape-md"; port: number }
  | { source: "probe"; port: number; attempts: readonly number[] }
  | { source: "none"; attempts: readonly number[]; reason: "no-probe-match" | "malformed-declaration" }

interface ParseResult {
  port: number | null
  malformed: boolean
}

export const parsePortFromShape = (content: string): ParseResult => {
  const runtimeBlocks: string[] = []
  const blockRe = new RegExp(RUNTIME_BLOCK_RE.source, "gm")
  let match: RegExpExecArray | null
  while ((match = blockRe.exec(content)) !== null) {
    runtimeBlocks.push(match[1] ?? "")
  }
  if (runtimeBlocks.length === 0) return { port: null, malformed: false }
  if (runtimeBlocks.length > 1) return { port: null, malformed: true }

  const block = runtimeBlocks[0]
  const ports: number[] = []
  let m: RegExpExecArray | null
  const globalRe = new RegExp(DEV_PORT_LINE_GLOBAL.source, "gm")
  while ((m = globalRe.exec(block)) !== null) {
    const n = parseInt(m[1], 10)
    if (Number.isFinite(n) && n >= 1 && n <= 65535) {
      ports.push(n)
    } else {
      return { port: null, malformed: true }
    }
  }
  if (ports.length === 0) return { port: null, malformed: false }
  if (ports.length > 1) return { port: null, malformed: true }
  return { port: ports[0], malformed: false }
}

const headProbe = (port: number, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port, method: "HEAD", path: "/", timeout: timeoutMs },
      (res) => {
        res.resume()
        resolve(true)
      },
    )
    req.on("timeout", () => {
      req.destroy()
      resolve(false)
    })
    req.on("error", () => resolve(false))
    req.end()
  })

interface ProbeOptions {
  timeoutPerProbeMs?: number
  totalTimeoutMs?: number
  probe?: (port: number, timeoutMs: number) => Promise<boolean>
  ports?: readonly number[]
}

export const probeDevServer = async (
  options: ProbeOptions = {},
): Promise<{ port: number | null; attempts: readonly number[] }> => {
  const perProbe = options.timeoutPerProbeMs ?? DEFAULT_PROBE_TIMEOUT_MS
  const total = options.totalTimeoutMs ?? DEFAULT_TOTAL_PROBE_MS
  const probeFn = options.probe ?? headProbe
  const ports = options.ports ?? PROBE_PORTS

  const attempts: number[] = []
  const start = Date.now()
  for (const port of ports) {
    if (Date.now() - start >= total) break
    attempts.push(port)
    const ok = await probeFn(port, perProbe).catch(() => false)
    if (ok) return { port, attempts }
  }
  return { port: null, attempts }
}

const readShapeMd = (input: SensorInput): string | null => {
  const candidate =
    input.shapeMdPath ??
    (input.buildDir ? path.join(input.buildDir, "shape.md") : null)
  if (!candidate) return null
  if (!fs.existsSync(candidate)) return null
  try {
    return fs.readFileSync(candidate, "utf-8")
  } catch {
    return null
  }
}

const logWarn = (line: string): void => {
  process.stderr.write(`${line}\n`)
}

export const resolveDevServerPort = async (
  input: SensorInput,
  options: ProbeOptions = {},
): Promise<PortResult> => {
  const shape = readShapeMd(input)
  if (shape) {
    const parsed = parsePortFromShape(shape)
    if (parsed.port !== null) {
      return { source: "shape-md", port: parsed.port }
    }
    if (parsed.malformed) {
      logWarn(
        `[ridgeline] WARN: shape.md ## Runtime has malformed dev-server port; falling back to probing`,
      )
    }
  }
  const { port, attempts } = await probeDevServer(options)
  if (port === null) {
    return { source: "none", attempts, reason: "no-probe-match" }
  }
  return { source: "probe", port, attempts }
}

const isSandboxDetected = (env: NodeJS.ProcessEnv = process.env): boolean => {
  if (env.RIDGELINE_SANDBOX) return true
  if (env.GREYWALL_ACTIVE) return true
  if (env.BWRAP_DETECTED) return true
  if (env.container) return true
  return false
}

interface PlaywrightModule {
  chromium: {
    launch(options: {
      args?: string[]
      timeout?: number
      headless?: boolean
    }): Promise<PlaywrightBrowser>
  }
}

interface PlaywrightBrowser {
  newPage(): Promise<PlaywrightPage>
  close(): Promise<void>
}

interface PlaywrightPage {
  goto(url: string, options?: { timeout?: number; waitUntil?: string }): Promise<unknown>
  screenshot(options: { path: string; fullPage?: boolean }): Promise<Buffer>
  close(): Promise<void>
  addScriptTag(options: { path: string }): Promise<unknown>
  evaluate<R>(fn: string | (() => R)): Promise<R>
}

type LoadPlaywright = () => PlaywrightModule

const defaultLoadPlaywright: LoadPlaywright = () =>
  require("playwright") as PlaywrightModule

const unresolvableFinding = (): SensorFinding => ({
  kind: "screenshot",
  severity: "warning",
  summary: `Playwright is not installed. Install with: ${PLAYWRIGHT_INSTALL_HINT}`,
})

const launchFailureFinding = (message: string): SensorFinding => ({
  kind: "screenshot",
  severity: "warning",
  summary: `Chromium launch failed — sandbox-incompatible (${message})`,
})

const noDevServerFinding = (attempts: readonly number[]): SensorFinding => ({
  kind: "screenshot",
  severity: "warning",
  summary: `no dev server detected (probed ports: ${attempts.join(", ") || "none"})`,
})

interface PlaywrightRunInternals {
  loadPlaywright?: LoadPlaywright
  isSandboxed?: () => boolean
  isResolvable?: () => boolean
  probeOptions?: ProbeOptions
  launchTimeoutMs?: number
}

export const runPlaywrightSensor = async (
  input: SensorInput,
  internals: PlaywrightRunInternals = {},
): Promise<SensorFinding[]> => {
  const resolvable = (internals.isResolvable ?? isPlaywrightResolvable)()
  if (!resolvable) {
    return [unresolvableFinding()]
  }

  const port = await resolveDevServerPort(input, internals.probeOptions).catch(() => ({
    source: "none" as const,
    attempts: [] as readonly number[],
    reason: "no-probe-match" as const,
  }))

  if (port.source === "none") {
    return [noDevServerFinding(port.attempts)]
  }

  const load = internals.loadPlaywright ?? defaultLoadPlaywright
  const sandboxed = (internals.isSandboxed ?? isSandboxDetected)()
  const launchTimeout = internals.launchTimeoutMs ?? LAUNCH_TIMEOUT_MS
  const launchArgs = sandboxed ? ["--no-sandbox", "--disable-setuid-sandbox"] : []

  let playwright: PlaywrightModule
  try {
    playwright = load()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.toLowerCase().includes("cannot find module")) {
      return [unresolvableFinding()]
    }
    return [launchFailureFinding(message)]
  }

  let browser: PlaywrightBrowser
  try {
    browser = await playwright.chromium.launch({
      args: launchArgs,
      timeout: launchTimeout,
      headless: true,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/executable doesn.?t exist|browser not found|playwright install/i.test(message)) {
      return [unresolvableFinding()]
    }
    return [launchFailureFinding(message)]
  }

  const artifactsDir =
    input.artifactsDir ??
    (input.buildDir ? path.join(input.buildDir, "artifacts") : path.join(input.cwd, ".ridgeline", "artifacts"))
  try {
    fs.mkdirSync(artifactsDir, { recursive: true })
  } catch {
    // directory creation failed — fall through; screenshot will fail non-fatally
  }

  const screenshotPath = path.join(artifactsDir, `screenshot-${Date.now()}.png`)
  const url = input.url ?? `http://127.0.0.1:${port.port}`

  try {
    const page = await browser.newPage()
    await page.goto(url, { waitUntil: "load", timeout: launchTimeout })
    await page.screenshot({ path: screenshotPath, fullPage: true })
    await page.close()
  } catch (err) {
    await browser.close().catch(() => {})
    const message = err instanceof Error ? err.message : String(err)
    return [
      {
        kind: "screenshot",
        severity: "warning",
        summary: `screenshot failed at ${url}: ${message}`,
      },
    ]
  }

  await browser.close().catch(() => {})

  return [
    {
      kind: "screenshot",
      severity: "info",
      path: screenshotPath,
      summary: `captured screenshot of ${url} (port source: ${port.source})`,
    },
  ]
}

const playwrightSensor: SensorAdapter = {
  name: "playwright",
  run: (input: SensorInput): Promise<SensorFinding[]> => runPlaywrightSensor(input),
}

export default playwrightSensor
