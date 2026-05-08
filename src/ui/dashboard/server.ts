import * as http from "node:http"
import * as fs from "node:fs"
import * as path from "node:path"
import { loadBudget } from "../../stores/budget.js"
import { loadState } from "../../stores/state.js"
import { readTrajectory } from "../../stores/trajectory.js"
import type { BudgetState, BuildState, TrajectoryEntry } from "../../types.js"
import { renderHtml } from "./html.js"
import { buildSnapshot, DashboardSnapshot } from "./snapshot.js"
import { createEventBuffer, EventName } from "./events.js"
import { watchAppend, watchJson } from "./watcher.js"

export interface StartDashboardOptions {
  buildName: string | null
  buildDir: string | null
  port: number
  host?: string
}

export interface DashboardServer {
  port: number
  host: string
  url: string
  close(): Promise<void>
  address(): string
}

export interface DashboardApp {
  handle(req: http.IncomingMessage, res: http.ServerResponse): void
  setPort(port: number): void
  broadcast(name: EventName, payload: unknown): void
  snapshot(): DashboardSnapshot
  clientCount(): number
  close(): void
}

const HEARTBEAT_MS = 20_000

interface Client {
  res: http.ServerResponse
  heartbeat: NodeJS.Timeout
}

const readBudget = (buildDir: string | null): BudgetState => {
  if (!buildDir) return { entries: [], totalCostUsd: 0 }
  try { return loadBudget(buildDir) } catch { return { entries: [], totalCostUsd: 0 } }
}

const readState = (buildDir: string | null): BuildState | null => {
  if (!buildDir) return null
  try { return loadState(buildDir) } catch { return null }
}

const readTraj = (buildDir: string | null): TrajectoryEntry[] => {
  if (!buildDir) return []
  try { return readTrajectory(buildDir) } catch { return [] }
}

const ensureDir = (dir: string | null): void => {
  if (!dir) return
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
}

export const createDashboardApp = (opts: StartDashboardOptions): DashboardApp => {
  const buildDir = opts.buildDir
  const buildName = opts.buildName

  ensureDir(buildDir)

  let cachedState: BuildState | null = readState(buildDir)
  let cachedBudget: BudgetState = readBudget(buildDir)
  let cachedTrajectory: TrajectoryEntry[] = readTraj(buildDir)
  let announcedPort = opts.port

  const renderSnapshot = (): DashboardSnapshot =>
    buildSnapshot(buildName, cachedState, cachedBudget, cachedTrajectory)

  const buffer = createEventBuffer(200)
  const clients = new Set<Client>()

  const broadcast = (name: EventName, payload: unknown): void => {
    const event = buffer.push(name, payload)
    const frame = `event: ${event.name}\nid: ${event.id}\ndata: ${event.data}\n\n`
    for (const client of clients) {
      try { client.res.write(frame) } catch { /* dead client */ }
    }
  }

  const watchers: { stop: () => void }[] = []
  if (buildDir) {
    const stateWatcher = watchJson(path.join(buildDir, "state.json"), (parsed) => {
      cachedState = parsed as BuildState
      broadcast("state", renderSnapshot())
    })
    stateWatcher.start()
    watchers.push(stateWatcher)

    const budgetWatcher = watchJson(path.join(buildDir, "budget.json"), (parsed) => {
      cachedBudget = parsed as BudgetState
      broadcast("budget", renderSnapshot().budget)
    })
    budgetWatcher.start()
    watchers.push(budgetWatcher)

    const trajectoryWatcher = watchAppend(path.join(buildDir, "trajectory.jsonl"), (lines) => {
      for (const line of lines) {
        let parsed: unknown
        try { parsed = JSON.parse(line) } catch { continue }
        cachedTrajectory.push(parsed as TrajectoryEntry)
        broadcast("trajectory", parsed)
      }
      cachedState = readState(buildDir)
      broadcast("state", renderSnapshot())
    })
    trajectoryWatcher.start()
    watchers.push(trajectoryWatcher)
  }

  const handle = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const url = req.url ?? "/"
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "text/plain" })
      res.end("Method Not Allowed")
      return
    }

    if (url === "/" || url.startsWith("/?")) {
      const html = renderHtml({ buildName, port: announcedPort, snapshot: renderSnapshot() })
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(html)
      return
    }

    if (url === "/state") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(renderSnapshot()))
      return
    }

    if (url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      })
      res.write("retry: 2000\n\n")

      const lastIdHeader = req.headers["last-event-id"]
      const lastId = typeof lastIdHeader === "string" ? parseInt(lastIdHeader, 10) : NaN
      if (!isNaN(lastId)) {
        for (const ev of buffer.replayAfter(lastId)) {
          res.write(`event: ${ev.name}\nid: ${ev.id}\ndata: ${ev.data}\n\n`)
        }
      } else {
        const initial = buffer.push("state", renderSnapshot())
        res.write(`event: ${initial.name}\nid: ${initial.id}\ndata: ${initial.data}\n\n`)
      }

      const heartbeat = setInterval(() => {
        try { res.write(": heartbeat\n\n") } catch { /* ignore */ }
      }, HEARTBEAT_MS)

      const client: Client = { res, heartbeat }
      clients.add(client)

      const cleanup = (): void => {
        clearInterval(heartbeat)
        clients.delete(client)
      }
      req.on("close", cleanup)
      res.on("close", cleanup)
      return
    }

    res.writeHead(404, { "Content-Type": "text/plain" })
    res.end("Not Found")
  }

  return {
    handle,
    setPort: (port: number): void => { announcedPort = port },
    broadcast,
    snapshot: renderSnapshot,
    clientCount: (): number => clients.size,
    close: (): void => {
      for (const w of watchers) w.stop()
      for (const c of clients) {
        clearInterval(c.heartbeat)
        try { c.res.end() } catch { /* ignore */ }
      }
      clients.clear()
    },
  }
}

export const startDashboard = async (
  opts: StartDashboardOptions,
): Promise<DashboardServer> => {
  const host = opts.host ?? "127.0.0.1"
  const app = createDashboardApp(opts)
  const server = http.createServer((req, res) => app.handle(req, res))

  let actualPort = opts.port
  await new Promise<void>((resolve, reject) => {
    const tryListen = (port: number, attempts: number): void => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && attempts > 0) {
          tryListen(port === 0 ? 0 : port + 1, attempts - 1)
        } else {
          reject(err)
        }
      })
      server.listen(port, host, () => {
        const addr = server.address()
        if (addr && typeof addr === "object") actualPort = addr.port
        server.removeAllListeners("error")
        resolve()
      })
    }
    tryListen(opts.port, 30)
  })

  app.setPort(actualPort)

  return {
    host,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    address: (): string => `http://${host}:${actualPort}`,
    close: async (): Promise<void> => {
      app.close()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections?.()
      })
    },
  }
}
