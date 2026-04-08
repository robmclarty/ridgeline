import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../git", () => ({
  createTag: vi.fn(),
  tagExists: vi.fn(() => true),
  isWorkingTreeDirty: vi.fn(() => false),
  commitAll: vi.fn(),
  deleteTagsByPrefix: vi.fn(),
}))

import { createTag, tagExists, isWorkingTreeDirty, commitAll, deleteTagsByPrefix } from "../../git"
import {
  checkpointTagName,
  completionTagName,
  createCheckpoint,
  createCompletionTag,
  verifyCompletionTag,
  cleanupBuildTags,
} from "../tags"

describe("tags", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("checkpointTagName", () => {
    it("returns correct checkpoint tag format", () => {
      expect(checkpointTagName("my-build", "01-scaffold")).toBe("ridgeline/checkpoint/my-build/01-scaffold")
    })
  })

  describe("completionTagName", () => {
    it("returns correct completion tag format", () => {
      expect(completionTagName("my-build", "01-scaffold")).toBe("ridgeline/phase/my-build/01-scaffold")
    })
  })

  describe("createCheckpoint", () => {
    it("creates tag without committing when tree is clean", () => {
      vi.mocked(isWorkingTreeDirty).mockReturnValue(false)

      createCheckpoint("ridgeline/checkpoint/build/01-scaffold", "01-scaffold")

      expect(commitAll).not.toHaveBeenCalled()
      expect(createTag).toHaveBeenCalledWith("ridgeline/checkpoint/build/01-scaffold", undefined, true)
    })

    it("commits dirty tree before creating tag", () => {
      vi.mocked(isWorkingTreeDirty).mockReturnValue(true)

      createCheckpoint("ridgeline/checkpoint/build/01-scaffold", "01-scaffold")

      expect(commitAll).toHaveBeenCalledWith("chore: pre-phase checkpoint for 01-scaffold", undefined)
      expect(createTag).toHaveBeenCalledWith("ridgeline/checkpoint/build/01-scaffold", undefined, true)
    })
  })

  describe("createCompletionTag", () => {
    it("creates tag and returns the tag name", () => {
      const tag = createCompletionTag("my-build", "01-scaffold")

      expect(tag).toBe("ridgeline/phase/my-build/01-scaffold")
      expect(createTag).toHaveBeenCalledWith("ridgeline/phase/my-build/01-scaffold", undefined, true)
    })
  })

  describe("verifyCompletionTag", () => {
    it("returns true when tag exists", () => {
      vi.mocked(tagExists).mockReturnValue(true)

      expect(verifyCompletionTag("my-build", "01-scaffold")).toBe(true)
      expect(tagExists).toHaveBeenCalledWith("ridgeline/phase/my-build/01-scaffold", undefined)
    })

    it("returns false when tag does not exist", () => {
      vi.mocked(tagExists).mockReturnValue(false)

      expect(verifyCompletionTag("my-build", "01-scaffold")).toBe(false)
    })
  })

  describe("cleanupBuildTags", () => {
    it("deletes all tag prefixes for a build", () => {
      cleanupBuildTags("my-build")

      expect(deleteTagsByPrefix).toHaveBeenCalledTimes(3)
      expect(deleteTagsByPrefix).toHaveBeenCalledWith("ridgeline/my-build/", undefined)
      expect(deleteTagsByPrefix).toHaveBeenCalledWith("ridgeline/checkpoint/my-build/", undefined)
      expect(deleteTagsByPrefix).toHaveBeenCalledWith("ridgeline/phase/my-build/", undefined)
    })
  })
})
