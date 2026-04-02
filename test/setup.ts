import { afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"

// Provide a helper to create isolated temp directories for tests that touch the filesystem
export const makeTempDir = (): string => {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ridgeline-test-"))
}

// Clean up any temp dirs after each test if needed
const tempDirs: string[] = []

export const trackTempDir = (dir: string): string => {
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  }
  tempDirs.length = 0
})
