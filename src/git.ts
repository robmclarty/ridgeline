import { execSync } from "node:child_process"

const run = (cmd: string, cwd?: string): string =>
  execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim()

export const getCurrentSha = (cwd?: string): string =>
  run("git rev-parse HEAD", cwd)

export const isWorkingTreeDirty = (cwd?: string): boolean =>
  run("git status --porcelain", cwd).length > 0

export const commitAll = (message: string, cwd?: string): void => {
  run("git add -A", cwd)
  try {
    run(`git commit -m ${JSON.stringify(message)}`, cwd)
  } catch {
    // Nothing to commit (working tree clean)
  }
}

export const createTag = (tagName: string, cwd?: string): void => {
  run(`git tag ${tagName}`, cwd)
}

export const tagExists = (tagName: string, cwd?: string): boolean => {
  const result = run(`git tag -l ${tagName}`, cwd)
  return result.length > 0
}

export const getDiff = (fromTag: string, cwd?: string): string => {
  try {
    return run(`git diff ${fromTag}..HEAD`, cwd)
  } catch {
    return ""
  }
}

export const getChangedFileNames = (fromTag: string, cwd?: string): string[] => {
  try {
    const output = run(`git diff --name-only ${fromTag}..HEAD`, cwd)
    return output ? output.split("\n").filter(Boolean) : []
  } catch {
    return []
  }
}

export const getChangedFileContents = (fromTag: string, cwd?: string): Map<string, string> => {
  const files = getChangedFileNames(fromTag, cwd)
  const contents = new Map<string, string>()
  const fs = require("node:fs")
  const path = require("node:path")
  const root = cwd ?? process.cwd()
  for (const file of files) {
    const fullPath = path.join(root, file)
    try {
      contents.set(file, fs.readFileSync(fullPath, "utf-8"))
    } catch {
      // File was deleted in the diff
    }
  }
  return contents
}

export const deleteTag = (tagName: string, cwd?: string): void => {
  try {
    run(`git tag -d ${tagName}`, cwd)
  } catch {
    // Tag doesn't exist
  }
}
