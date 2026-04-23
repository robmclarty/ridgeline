import * as fs from "node:fs"
import * as path from "node:path"

const watchFileByDirectory = (filePath: string, onChange: () => void): fs.FSWatcher | null => {
  try {
    const dir = path.dirname(filePath)
    const base = path.basename(filePath)
    const w = fs.watch(dir, { persistent: false }, (_event, fname) => {
      if (!fname) return
      if (fname !== base) return
      onChange()
    })
    w.on("error", () => { /* ignore */ })
    return w
  } catch {
    return null
  }
}

export interface JsonWatcher {
  read(): unknown
  start(): void
  stop(): void
}

export const watchJson = (
  filePath: string,
  onChange: (parsed: unknown) => void,
  debounceMs: number = 50,
): JsonWatcher => {
  let last: string | null = null
  let watcher: fs.FSWatcher | null = null
  let dirWatcher: fs.FSWatcher | null = null
  let timer: NodeJS.Timeout | null = null

  const readFile = (): { raw: string; parsed: unknown } | null => {
    try {
      const raw = fs.readFileSync(filePath, "utf-8")
      return { raw, parsed: JSON.parse(raw) }
    } catch {
      return null
    }
  }

  const flush = (): void => {
    const result = readFile()
    if (!result) return
    if (result.raw === last) return
    last = result.raw
    onChange(result.parsed)
  }

  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, debounceMs)
  }

  const attachFileWatcher = (): void => {
    if (watcher) return
    try {
      watcher = fs.watch(filePath, { persistent: false }, () => schedule())
      watcher.on("error", () => { detachFileWatcher() })
    } catch {
      // File doesn't exist yet — dir watcher will catch creation
    }
  }

  const detachFileWatcher = (): void => {
    if (!watcher) return
    try { watcher.close() } catch { /* ignore */ }
    watcher = null
  }

  return {
    read: (): unknown => {
      const r = readFile()
      if (r) last = r.raw
      return r ? r.parsed : null
    },
    start: (): void => {
      const initial = readFile()
      if (initial) last = initial.raw

      dirWatcher = watchFileByDirectory(filePath, () => {
        attachFileWatcher()
        schedule()
      })
      attachFileWatcher()
    },
    stop: (): void => {
      if (timer) { clearTimeout(timer); timer = null }
      detachFileWatcher()
      if (dirWatcher) {
        try { dirWatcher.close() } catch { /* ignore */ }
        dirWatcher = null
      }
    },
  }
}

export interface TailWatcher {
  start(): void
  stop(): void
  offset(): number
  readAppended(): string[]
}

export const watchAppend = (
  filePath: string,
  onLines: (lines: string[]) => void,
): TailWatcher => {
  let offset = 0
  let watcher: fs.FSWatcher | null = null
  let dirWatcher: fs.FSWatcher | null = null

  const attachFileWatcher = (): void => {
    if (watcher) return
    try {
      watcher = fs.watch(filePath, { persistent: false }, () => flush())
      watcher.on("error", () => {
        try { watcher?.close() } catch { /* ignore */ }
        watcher = null
      })
    } catch {
      // file doesn't exist yet
    }
  }

  const readAppended = (): string[] => {
    let stat: fs.Stats
    try {
      stat = fs.statSync(filePath)
    } catch {
      return []
    }
    if (stat.size < offset) {
      // truncated — reset
      offset = 0
    }
    if (stat.size === offset) return []
    let buf: Buffer
    let fd: number
    try {
      fd = fs.openSync(filePath, "r")
    } catch {
      return []
    }
    try {
      const length = stat.size - offset
      buf = Buffer.alloc(length)
      fs.readSync(fd, buf, 0, length, offset)
    } finally {
      try { fs.closeSync(fd) } catch { /* ignore */ }
    }
    offset = stat.size
    const text = buf.toString("utf-8")
    return text.split("\n").filter((l) => l.length > 0)
  }

  const flush = (): void => {
    const lines = readAppended()
    if (lines.length > 0) onLines(lines)
  }

  return {
    start: (): void => {
      try {
        const stat = fs.statSync(filePath)
        offset = stat.size
      } catch {
        offset = 0
      }
      dirWatcher = watchFileByDirectory(filePath, () => {
        attachFileWatcher()
        flush()
      })
      attachFileWatcher()
    },
    stop: (): void => {
      if (watcher) {
        try { watcher.close() } catch { /* ignore */ }
        watcher = null
      }
      if (dirWatcher) {
        try { dirWatcher.close() } catch { /* ignore */ }
        dirWatcher = null
      }
    },
    offset: (): number => offset,
    readAppended,
  }
}
