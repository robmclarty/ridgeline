import { createTag, tagExists, isWorkingTreeDirty, commitAll, deleteTagsByPrefix } from "../git"

export const checkpointTagName = (buildName: string, phaseId: string): string =>
  `ridgeline/checkpoint/${buildName}/${phaseId}`

export const completionTagName = (buildName: string, phaseId: string): string =>
  `ridgeline/phase/${buildName}/${phaseId}`

// Commit dirty working tree and create a checkpoint tag
export const createCheckpoint = (checkpointTag: string, phaseId: string, cwd?: string): void => {
  if (isWorkingTreeDirty(cwd)) {
    commitAll(`chore: pre-phase checkpoint for ${phaseId}`, cwd)
  }
  createTag(checkpointTag, cwd, true)
}

// Create a completion tag for a phase and return the tag name
export const createCompletionTag = (buildName: string, phaseId: string, cwd?: string): string => {
  const tag = completionTagName(buildName, phaseId)
  createTag(tag, cwd, true)
  return tag
}

// Verify that a phase's completion tag exists in git
export const verifyCompletionTag = (buildName: string, phaseId: string, cwd?: string): boolean =>
  tagExists(completionTagName(buildName, phaseId), cwd)

// Delete all ridgeline tags for a build
export const cleanupBuildTags = (buildName: string, cwd?: string): void => {
  deleteTagsByPrefix(`ridgeline/${buildName}/`, cwd)
  deleteTagsByPrefix(`ridgeline/checkpoint/${buildName}/`, cwd)
  deleteTagsByPrefix(`ridgeline/phase/${buildName}/`, cwd)
}
