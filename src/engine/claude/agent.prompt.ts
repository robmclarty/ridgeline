import * as fs from "node:fs"
import * as path from "node:path"

export const resolveAgentPrompt = (filename: string): string => {
  const distPath = path.join(__dirname, "..", "agents", "core", filename)
  if (fs.existsSync(distPath)) return fs.readFileSync(distPath, "utf-8")
  const srcPath = path.join(__dirname, "..", "..", "agents", "core", filename)
  if (fs.existsSync(srcPath)) return fs.readFileSync(srcPath, "utf-8")
  const rootPath = path.join(__dirname, "..", "..", "..", "src", "agents", "core", filename)
  return fs.readFileSync(rootPath, "utf-8")
}
