import { describe, expect, it } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"

const DASHBOARD_DIR = path.join(__dirname, "..")
const COMMAND_UI = path.join(__dirname, "..", "..", "..", "commands", "ui.ts")

const readTs = (dir: string): string => {
  let out = ""
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "__tests__") continue
    const fp = path.join(dir, e.name)
    if (e.isDirectory()) out += readTs(fp)
    else if (e.isFile() && e.name.endsWith(".ts")) out += fs.readFileSync(fp, "utf-8")
  }
  return out
}

describe("dashboard does not use fs.watchFile polling", () => {
  it("no fs.watchFile calls in src/ui/dashboard or src/commands/ui.ts", () => {
    const body = readTs(DASHBOARD_DIR) + fs.readFileSync(COMMAND_UI, "utf-8")
    expect(body).not.toMatch(/\bwatchFile\s*\(/)
    expect(body).not.toMatch(/fs\.watchFile\b/)
  })
})
