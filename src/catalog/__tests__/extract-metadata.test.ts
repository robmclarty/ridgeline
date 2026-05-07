import { describe, it, expect } from "vitest"
import { detectSpritesheet, computeContentHash } from "../extract-metadata.js"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeTempDir } from "../../../test/setup.js"

describe("detectSpritesheet", () => {
  it("detects horizontal spritesheet (128x32 = 4 frames)", () => {
    const result = detectSpritesheet(128, 32)
    expect(result).toEqual({
      isSpritesheet: true,
      frameCount: 4,
      frameSize: { w: 32, h: 32 },
      frameDirection: "horizontal",
    })
  })

  it("detects vertical spritesheet (32x96 = 3 frames)", () => {
    const result = detectSpritesheet(32, 96)
    expect(result).toEqual({
      isSpritesheet: true,
      frameCount: 3,
      frameSize: { w: 32, h: 32 },
      frameDirection: "vertical",
    })
  })

  it("returns non-spritesheet for square image", () => {
    const result = detectSpritesheet(32, 32)
    expect(result).toEqual({
      isSpritesheet: false,
      frameCount: 1,
      frameSize: null,
      frameDirection: null,
    })
  })

  it("returns non-spritesheet for non-multiple dimensions", () => {
    const result = detectSpritesheet(100, 60)
    expect(result).toEqual({
      isSpritesheet: false,
      frameCount: 1,
      frameSize: null,
      frameDirection: null,
    })
  })

  it("returns non-spritesheet for zero dimensions", () => {
    const result = detectSpritesheet(0, 32)
    expect(result).toEqual({
      isSpritesheet: false,
      frameCount: 1,
      frameSize: null,
      frameDirection: null,
    })
  })
})

describe("computeContentHash", () => {
  it("produces consistent MD5 hash for file content", () => {
    const tmpDir = makeTempDir()
    const filePath = path.join(tmpDir, "test.bin")
    fs.writeFileSync(filePath, "hello world")

    const hash1 = computeContentHash(filePath)
    const hash2 = computeContentHash(filePath)
    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(/^[a-f0-9]{32}$/)

    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("produces different hash for different content", () => {
    const tmpDir = makeTempDir()
    const file1 = path.join(tmpDir, "a.bin")
    const file2 = path.join(tmpDir, "b.bin")
    fs.writeFileSync(file1, "content A")
    fs.writeFileSync(file2, "content B")

    expect(computeContentHash(file1)).not.toBe(computeContentHash(file2))

    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})
