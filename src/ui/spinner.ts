// Bouncing-bar spinner ("Cylon eye") for indicating LLM thinking.
//
// Frames animate a lit segment bouncing left-to-right then right-to-left:
//   [=   ] → [==  ] → … → [  ==] → [   =] → [  ==] → … → [=   ] (ping-pong)

import { clearLineSequence, hint } from "./color"

const FRAMES = [
  "[=   ]",
  "[==  ]",
  "[=== ]",
  "[====]",
  "[ ===]",
  "[  ==]",
  "[   =]",
]

const DEFAULT_INTERVAL_MS = 120

const VERBS = [
  "Cogitating",
  "Ruminating",
  "Percolating",
  "Discombobulating",
  "Confabulating",
  "Splunking",
  "Boffinating",
  "Transmogrifying",
  "Flibberting",
  "Noodling",
  "Vibing",
  "Befuddling",
  "Wonkifying",
  "Rummaging",
  "Galumphing",
  "Snorkeling",
  "Blatherskiting",
  "Discombobbing",
  "Flummoxing",
  "Glibsnarking",
  "Computering",
  "Smoldering",
  "Bamboozling",
  "Frobnicating",
  "Guesstimating",
  "Thinkinating",
  "Zaphoddling",
  "Quibblecrunching",
  "Musing",
  "Cromulating",
  "Embigulating",
  "Fluxwarping",
  "Jiggulating",
  "Recalibrating",
  "Ciphering",
  "Befrobbling",
  "Harmonizing",
  "Kibbitzing",
  "Brainstorming",
  "Snazzifying",
  "Phantasming",
  "Ratiocinating",
  "Cerebrating",
  "Woolgathering",
  "Confuzzling",
  "Pontificating",
  "Tinkering",
  "Blinkenstopping",
  "Mulligrubbing",
  "Hypothecating",
]

export interface Spinner {
  /** Stop the animation and clear the spinner line. */
  stop(): void
  /** Temporarily pause the spinner and clear its line (for printing output). */
  pause(): void
  /** Resume the spinner after a pause. */
  resume(): void
  /** Show a tool name or detail next to the spinner (e.g. "Read", "Bash"). */
  setDetail(detail: string): void
  /** Print a permanent line above the spinner, then redraw the spinner below it. */
  printAbove(line: string): void
}

export const pickVerb = (): string =>
  VERBS[Math.floor(Math.random() * VERBS.length)]

export const formatElapsed = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`
  }
  return `${seconds}s`
}

/**
 * Start a bouncing-bar spinner on stderr with an optional verb label.
 *
 * The spinner writes to stderr so it never contaminates captured stdout.
 * Calling `stop()` clears the line and restores the cursor.
 */
export const startSpinner = (verb?: string): Spinner => {
  // If stderr is not a TTY (e.g. piped to a file), skip animation entirely.
  if (!process.stderr.isTTY) {
    return { stop() {}, pause() {}, resume() {}, setDetail() {}, printAbove() {} }
  }

  let frameIndex = 0
  let direction = 1
  let pauseFrames = 0
  let stopped = false
  let detail = ""
  const label = verb ?? pickVerb()
  const startTime = Date.now()

  const tick = () => {
    const frame = FRAMES[frameIndex]
    const elapsed = formatElapsed(Date.now() - startTime)
    const suffix = detail ? ` [${detail}]` : ""
    process.stderr.write(`${clearLineSequence()}${frame} ${label}... (${elapsed})${suffix}`)
    if (pauseFrames > 0) {
      pauseFrames--
      return
    }
    frameIndex += direction
    if (frameIndex >= FRAMES.length - 1 || frameIndex <= 0) {
      direction *= -1
      pauseFrames = 1
    }
  }

  let timer: ReturnType<typeof setInterval> | null = setInterval(
    tick,
    DEFAULT_INTERVAL_MS,
  )

  const clearLine = () => {
    process.stderr.write(clearLineSequence())
  }

  return {
    stop() {
      if (stopped) return
      stopped = true
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      clearLine()
    },
    pause() {
      if (stopped || !timer) return
      clearInterval(timer)
      timer = null
      clearLine()
    },
    resume() {
      if (stopped || timer) return
      timer = setInterval(tick, DEFAULT_INTERVAL_MS)
    },
    setDetail(text: string) {
      detail = text
    },
    printAbove(line: string) {
      if (stopped || !timer) return
      clearLine()
      process.stderr.write(`${hint(line, { stream: "stderr" })}\n`)
      tick()
    },
  }
}
