import { printInfo } from "../ui/output"
import { cleanAllWorktrees } from "../engine/worktree"

export const runClean = (repoRoot: string): void => {
  printInfo("Cleaning up worktrees...")
  cleanAllWorktrees(repoRoot)
  printInfo("Done.")
}
