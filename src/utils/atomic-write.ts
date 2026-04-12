import * as fs from "node:fs"
import * as path from "node:path"
import * as crypto from "node:crypto"

/**
 * Write a file atomically: write to a temp file in the same directory,
 * then rename. renameSync is atomic on the same filesystem, so a crash
 * mid-write cannot leave a truncated target file.
 */
export const atomicWriteSync = (filePath: string, content: string): void => {
  const dir = path.dirname(filePath)
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${crypto.randomBytes(4).toString("hex")}.tmp`,
  )
  try {
    fs.writeFileSync(tmp, content, { mode: 0o644 })
    fs.renameSync(tmp, filePath)
  } catch (err) {
    // Clean up the temp file if rename fails
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    throw err
  }
}
