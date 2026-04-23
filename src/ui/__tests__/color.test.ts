import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  bold,
  clearLineSequence,
  dimInfo,
  error,
  hint,
  info,
  isColorEnabled,
  stripAnsi,
  success,
  warning,
} from "../color"

const ESC = String.fromCharCode(27)
const RESET = `${ESC}[0m`

describe("color helper", () => {
  let originalNoColor: string | undefined
  let originalStdoutIsTTY: boolean | undefined
  let originalStderrIsTTY: boolean | undefined

  beforeEach(() => {
    originalNoColor = process.env.NO_COLOR
    originalStdoutIsTTY = process.stdout.isTTY
    originalStderrIsTTY = process.stderr.isTTY
    delete process.env.NO_COLOR
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true })
    Object.defineProperty(process.stderr, "isTTY", { value: true, writable: true })
  })

  afterEach(() => {
    if (originalNoColor === undefined) delete process.env.NO_COLOR
    else process.env.NO_COLOR = originalNoColor
    Object.defineProperty(process.stdout, "isTTY", { value: originalStdoutIsTTY, writable: true })
    Object.defineProperty(process.stderr, "isTTY", { value: originalStderrIsTTY, writable: true })
  })

  describe("semantic roles", () => {
    it("error wraps with ANSI red (31)", () => {
      expect(error("oops")).toBe(`${ESC}[31moops${RESET}`)
    })

    it("success wraps with ANSI green (32)", () => {
      expect(success("ok")).toBe(`${ESC}[32mok${RESET}`)
    })

    it("warning wraps with ANSI yellow (33)", () => {
      expect(warning("careful")).toBe(`${ESC}[33mcareful${RESET}`)
    })

    it("info wraps with ANSI cyan (36)", () => {
      expect(info("running")).toBe(`${ESC}[36mrunning${RESET}`)
    })

    it("hint wraps with dim attribute (code 2)", () => {
      expect(hint("dim")).toBe(`${ESC}[2mdim${RESET}`)
    })

    it("bold wraps with code 1", () => {
      expect(bold("strong")).toBe(`${ESC}[1mstrong${RESET}`)
    })

    it("dimInfo wraps with combined dim + cyan", () => {
      expect(dimInfo("→")).toBe(`${ESC}[2;36m→${RESET}`)
    })
  })

  describe("NO_COLOR / non-TTY stripping", () => {
    it("strips colors when NO_COLOR is set, keeping content byte-identical", () => {
      process.env.NO_COLOR = "1"
      expect(error("oops")).toBe("oops")
      expect(success("ok")).toBe("ok")
      expect(warning("careful")).toBe("careful")
      expect(info("running")).toBe("running")
      expect(hint("dim")).toBe("dim")
      expect(bold("strong")).toBe("strong")
      expect(dimInfo("→")).toBe("→")
    })

    it("strips colors when stream is not a TTY", () => {
      Object.defineProperty(process.stdout, "isTTY", { value: false, writable: true })
      expect(error("oops")).toBe("oops")
      expect(info("hi")).toBe("hi")
    })

    it("respects per-stream TTY state", () => {
      Object.defineProperty(process.stdout, "isTTY", { value: false, writable: true })
      Object.defineProperty(process.stderr, "isTTY", { value: true, writable: true })
      expect(error("oops")).toBe("oops")
      expect(error("oops", { stream: "stderr" })).toBe(`${ESC}[31moops${RESET}`)
    })

    it("force=true keeps colors even with NO_COLOR / no TTY", () => {
      process.env.NO_COLOR = "1"
      Object.defineProperty(process.stdout, "isTTY", { value: false, writable: true })
      expect(error("oops", { force: true })).toBe(`${ESC}[31moops${RESET}`)
    })

    it("isColorEnabled reflects env + tty", () => {
      expect(isColorEnabled("stdout")).toBe(true)
      process.env.NO_COLOR = "1"
      expect(isColorEnabled("stdout")).toBe(false)
    })

    it("stripped output is byte-identical to colored output minus the SGR codes", () => {
      process.env.NO_COLOR = ""
      // empty NO_COLOR is treated as unset
      const colored = error("the quick brown fox")
      expect(colored).toContain(`${ESC}[31m`)
      expect(stripAnsi(colored)).toBe("the quick brown fox")
    })
  })

  describe("clearLineSequence", () => {
    it("returns CR + ANSI clear-to-end-of-line", () => {
      expect(clearLineSequence()).toBe(`\r${ESC}[K`)
    })
  })

  describe("stripAnsi", () => {
    it("strips a single SGR sequence", () => {
      expect(stripAnsi(`${ESC}[33mhello${RESET}`)).toBe("hello")
    })

    it("strips multiple sequences", () => {
      expect(stripAnsi(`${ESC}[31mfoo${RESET} ${ESC}[36mbar${RESET}`)).toBe("foo bar")
    })

    it("returns input unchanged when no escape sequences are present", () => {
      expect(stripAnsi("plain text")).toBe("plain text")
    })
  })
})
