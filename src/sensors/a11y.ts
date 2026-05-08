import { createRequire } from "node:module"
import type { SensorAdapter, SensorFinding, SensorInput } from "./index.js"
import { resolveDevServerPort } from "./playwright.js"

const nodeRequire = createRequire(import.meta.url)

const PLAYWRIGHT_INSTALL_HINT =
  "npm install --save-dev playwright && npx playwright install chromium"

const isPlaywrightResolvable = (): boolean => {
  try {
    nodeRequire.resolve("playwright")
    return true
  } catch {
    return false
  }
}

const LAUNCH_TIMEOUT_MS = 10_000

interface AxeResults {
  violations: ReadonlyArray<{
    id: string
    impact?: string | null
    description: string
    help?: string
    nodes: ReadonlyArray<{ target: string[] }>
  }>
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
  addScriptTag(options: { path: string }): Promise<unknown>
  evaluate<R>(fn: string | (() => R)): Promise<R>
  close(): Promise<void>
}

type A11yLoadPlaywright = () => PlaywrightModule
type ResolveAxePath = () => string

const defaultA11yLoadPlaywright: A11yLoadPlaywright = () =>
  nodeRequire("playwright") as PlaywrightModule

const defaultResolveAxePath: ResolveAxePath = () =>
  nodeRequire.resolve("axe-core")

const unresolvableFinding = (): SensorFinding => ({
  kind: "a11y",
  severity: "warning",
  summary: `Playwright is not installed. Install with: ${PLAYWRIGHT_INSTALL_HINT}`,
})

const isSandboxDetected = (env: NodeJS.ProcessEnv = process.env): boolean =>
  Boolean(env.RIDGELINE_SANDBOX || env.GREYWALL_ACTIVE || env.container)

const severityFromImpact = (impact: string | null | undefined): SensorFinding["severity"] => {
  switch (impact) {
    case "critical":
    case "serious":
      return "error"
    case "moderate":
      return "warning"
    default:
      return "info"
  }
}

const formatViolation = (v: AxeResults["violations"][number]): SensorFinding => ({
  kind: "a11y",
  severity: severityFromImpact(v.impact ?? null),
  summary: `${v.id} (${v.impact ?? "minor"}): ${v.help ?? v.description} [${v.nodes.length} node${v.nodes.length === 1 ? "" : "s"}]`,
})

interface A11yRunInternals {
  loadPlaywright?: A11yLoadPlaywright
  resolveAxePath?: ResolveAxePath
  isSandboxed?: () => boolean
  isResolvable?: () => boolean
}

export const runA11ySensor = async (
  input: SensorInput,
  internals: A11yRunInternals = {},
): Promise<SensorFinding[]> => {
  const resolvable = (internals.isResolvable ?? isPlaywrightResolvable)()
  if (!resolvable) {
    return [unresolvableFinding()]
  }

  const port = await resolveDevServerPort(input).catch(() => null)
  const url = input.url ?? (port && port.source !== "none" ? `http://127.0.0.1:${port.port}` : null)
  if (!url) {
    return [
      {
        kind: "a11y",
        severity: "warning",
        summary: "no dev server URL available for accessibility audit",
      },
    ]
  }

  const load = internals.loadPlaywright ?? defaultA11yLoadPlaywright
  const sandboxed = (internals.isSandboxed ?? isSandboxDetected)()
  const axePath = (internals.resolveAxePath ?? defaultResolveAxePath)()
  const launchArgs = sandboxed ? ["--no-sandbox", "--disable-setuid-sandbox"] : []

  let playwright: PlaywrightModule
  try {
    playwright = load()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.toLowerCase().includes("cannot find module")) {
      return [unresolvableFinding()]
    }
    return [
      {
        kind: "a11y",
        severity: "warning",
        summary: `accessibility audit skipped — sandbox-incompatible (${message})`,
      },
    ]
  }

  let browser: PlaywrightBrowser
  try {
    browser = await playwright.chromium.launch({
      args: launchArgs,
      timeout: LAUNCH_TIMEOUT_MS,
      headless: true,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/executable doesn.?t exist|browser not found|playwright install/i.test(message)) {
      return [unresolvableFinding()]
    }
    return [
      {
        kind: "a11y",
        severity: "warning",
        summary: `accessibility audit skipped — sandbox-incompatible (${message})`,
      },
    ]
  }

  try {
    const page = await browser.newPage()
    await page.goto(url, { waitUntil: "load", timeout: LAUNCH_TIMEOUT_MS })
    await page.addScriptTag({ path: axePath })
    const axeResults = await page.evaluate<AxeResults>(
      "window.axe.run(document, { resultTypes: ['violations'] })",
    )
    await page.close()
    await browser.close()

    if (axeResults.violations.length === 0) {
      return [
        {
          kind: "a11y",
          severity: "info",
          summary: `no WCAG AA violations detected at ${url}`,
        },
      ]
    }
    return axeResults.violations.map(formatViolation)
  } catch (err) {
    await browser.close().catch(() => {})
    const message = err instanceof Error ? err.message : String(err)
    return [
      {
        kind: "a11y",
        severity: "warning",
        summary: `accessibility audit failed at ${url}: ${message}`,
      },
    ]
  }
}

const a11ySensor: SensorAdapter = {
  name: "a11y",
  run: (input: SensorInput): Promise<SensorFinding[]> => runA11ySensor(input),
}

export default a11ySensor
