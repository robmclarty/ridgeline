import * as fs from "node:fs"

const RETRY_COUNT = 20
const RETRY_BASE_MS = 100
const STALE_THRESHOLD_MS = 60_000

/**
 * Simple synchronous file lock using O_CREAT | O_EXCL (atomic on all filesystems).
 * Wraps `fn()` in acquire/release, with jittered retry and stale lock detection.
 */
export const withFileLock = <T>(lockPath: string, fn: () => T): T => {
  acquire(lockPath)
  try {
    return fn()
  } finally {
    try { fs.unlinkSync(lockPath) } catch { /* already removed */ }
  }
}

const acquire = (lockPath: string): void => {
  for (let attempt = 0; attempt < RETRY_COUNT; attempt++) {
    try {
      const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY)
      fs.writeSync(fd, String(process.pid))
      fs.closeSync(fd)
      return
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err

      // Stale lock detection: if lock file is older than threshold, force-remove
      try {
        const stat = fs.statSync(lockPath)
        if (Date.now() - stat.mtimeMs > STALE_THRESHOLD_MS) {
          fs.unlinkSync(lockPath)
          continue
        }
      } catch {
        // Lock was released between our check and stat — retry
        continue
      }

      // Jittered backoff
      const jitter = Math.random() * RETRY_BASE_MS * 0.5
      const delay = RETRY_BASE_MS + jitter
      sleepSync(delay)
    }
  }

  throw new Error(`Failed to acquire file lock: ${lockPath} (after ${RETRY_COUNT} retries)`)
}

/** Synchronous sleep using Atomics.wait on a shared buffer. */
const sleepSync = (ms: number): void => {
  const buf = new SharedArrayBuffer(4)
  const view = new Int32Array(buf)
  Atomics.wait(view, 0, 0, Math.ceil(ms))
}
