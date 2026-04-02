import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { makeTempDir } from "../../test/setup"
import {
  getCurrentSha,
  isWorkingTreeDirty,
  commitAll,
  createTag,
  tagExists,
  getDiff,
  getChangedFileNames,
  getChangedFileContents,
  deleteTag,
} from "../git"

// Helper to create a temp git repo
const initTempRepo = (): string => {
  const dir = makeTempDir()
  execSync("git init", { cwd: dir, stdio: "pipe" })
  execSync("git config user.email 'test@test.com'", { cwd: dir, stdio: "pipe" })
  execSync("git config user.name 'Test'", { cwd: dir, stdio: "pipe" })
  // Create initial commit so HEAD exists
  fs.writeFileSync(path.join(dir, "init.txt"), "init")
  execSync("git add -A && git commit -m 'init'", { cwd: dir, stdio: "pipe" })
  return dir
}

describe("git", () => {
  let repoDir: string

  beforeEach(() => {
    repoDir = initTempRepo()
  })

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true })
  })

  describe("getCurrentSha", () => {
    it("returns a 40-character hex string", () => {
      const sha = getCurrentSha(repoDir)
      expect(sha).toMatch(/^[0-9a-f]{40}$/)
    })
  })

  describe("isWorkingTreeDirty", () => {
    it("returns false for clean tree", () => {
      expect(isWorkingTreeDirty(repoDir)).toBe(false)
    })

    it("returns true when there are uncommitted changes", () => {
      fs.writeFileSync(path.join(repoDir, "dirty.txt"), "dirty")
      expect(isWorkingTreeDirty(repoDir)).toBe(true)
    })
  })

  describe("commitAll", () => {
    it("stages and commits all changes", () => {
      fs.writeFileSync(path.join(repoDir, "new.txt"), "new file")
      commitAll("test commit", repoDir)

      const log = execSync("git log --oneline", { cwd: repoDir, encoding: "utf-8" })
      expect(log).toContain("test commit")
      expect(isWorkingTreeDirty(repoDir)).toBe(false)
    })

    it("does not throw when nothing to commit", () => {
      expect(() => commitAll("empty commit", repoDir)).not.toThrow()
    })
  })

  describe("createTag / tagExists / deleteTag", () => {
    it("creates a tag that can be detected", () => {
      createTag("test-tag", repoDir)
      expect(tagExists("test-tag", repoDir)).toBe(true)
    })

    it("returns false for nonexistent tag", () => {
      expect(tagExists("nonexistent", repoDir)).toBe(false)
    })

    it("deletes an existing tag", () => {
      createTag("to-delete", repoDir)
      deleteTag("to-delete", repoDir)
      expect(tagExists("to-delete", repoDir)).toBe(false)
    })

    it("does not throw when deleting nonexistent tag", () => {
      expect(() => deleteTag("no-such-tag", repoDir)).not.toThrow()
    })
  })

  describe("getDiff", () => {
    it("returns diff between tag and HEAD", () => {
      createTag("before-change", repoDir)
      fs.writeFileSync(path.join(repoDir, "changed.txt"), "content")
      commitAll("add changed file", repoDir)

      const diff = getDiff("before-change", repoDir)
      expect(diff).toContain("changed.txt")
      expect(diff).toContain("content")
    })

    it("returns empty string when tag does not exist", () => {
      expect(getDiff("nonexistent-tag", repoDir)).toBe("")
    })
  })

  describe("getChangedFileNames", () => {
    it("returns list of changed files", () => {
      createTag("baseline", repoDir)
      fs.writeFileSync(path.join(repoDir, "a.txt"), "a")
      fs.writeFileSync(path.join(repoDir, "b.txt"), "b")
      commitAll("add files", repoDir)

      const files = getChangedFileNames("baseline", repoDir)
      expect(files).toContain("a.txt")
      expect(files).toContain("b.txt")
    })

    it("returns empty array for nonexistent tag", () => {
      expect(getChangedFileNames("missing", repoDir)).toEqual([])
    })
  })

  describe("getChangedFileContents", () => {
    it("returns map of filename to contents", () => {
      createTag("snap", repoDir)
      fs.writeFileSync(path.join(repoDir, "file.txt"), "hello world")
      commitAll("add file", repoDir)

      const contents = getChangedFileContents("snap", repoDir)
      expect(contents.get("file.txt")).toBe("hello world")
    })

    it("handles deleted files gracefully", () => {
      fs.writeFileSync(path.join(repoDir, "temp.txt"), "temp")
      commitAll("add temp", repoDir)
      createTag("before-delete", repoDir)
      fs.unlinkSync(path.join(repoDir, "temp.txt"))
      commitAll("delete temp", repoDir)

      const contents = getChangedFileContents("before-delete", repoDir)
      // temp.txt was deleted so it should not be in the map (readFileSync fails)
      expect(contents.has("temp.txt")).toBe(false)
    })
  })
})
