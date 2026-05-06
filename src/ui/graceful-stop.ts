import * as readline from "node:readline"

const DOUBLE_PRESS_WINDOW_MS = 5_000

interface KeyPress {
  name?: string
  ctrl?: boolean
  sequence?: string
}

export interface GracefulStopOptions {
  /** Stream for the acknowledgment line. Defaults to `process.stderr`. */
  stream?: NodeJS.WritableStream
  /** Stream to listen on. Defaults to `process.stdin`. */
  input?: NodeJS.ReadableStream
  /** Whether the input is a TTY. Defaults to `process.stdin.isTTY`. */
  isTTY?: boolean
  /** Called on second press (or its equivalent escalation). Defaults to SIGINT. */
  onSecondPress?: () => void
}

export interface GracefulStopHandle {
  isRequested: () => boolean
  uninstall: () => void
}

const sendSelfSigint = (): void => {
  process.kill(process.pid, "SIGINT")
}

const NOOP_HANDLE: GracefulStopHandle = {
  isRequested: () => false,
  uninstall: () => undefined,
}

const isStopKey = (key: KeyPress): boolean => {
  if (key.name === "q" && !key.ctrl) return true
  if (key.ctrl && key.name === "g") return true
  return false
}

/**
 * Install a non-blocking listener for the graceful-stop keystroke.
 *
 * In a TTY, pressing `q` (or Ctrl-G) sets an in-process "stop after
 * the current phase" flag. Pressing it again within 5 seconds escalates
 * to a regular SIGINT for the user who realizes they need to stop NOW.
 *
 * In non-TTY environments the function returns a no-op handle — there's
 * no input stream to attach to, and the build proceeds unchanged.
 *
 * Always uninstall the handle when the build finishes (or fails) so the
 * process can exit cleanly.
 */
export const installGracefulStopListener = (
  opts: GracefulStopOptions = {},
): GracefulStopHandle => {
  const isTTY = opts.isTTY ?? Boolean(process.stdin.isTTY)
  if (!isTTY) return NOOP_HANDLE

  const stream = opts.stream ?? process.stderr
  const input = opts.input ?? process.stdin
  const onSecondPress = opts.onSecondPress ?? sendSelfSigint

  let requested = false
  let firstPressAt: number | null = null

  readline.emitKeypressEvents(input)
  const stdinAsTTY = input as NodeJS.ReadStream
  const previousRawMode = stdinAsTTY.isRaw ?? false
  if (typeof stdinAsTTY.setRawMode === "function") {
    stdinAsTTY.setRawMode(true)
  }

  const handler = (_chunk: string | undefined, key: KeyPress | undefined): void => {
    if (!key) return
    if (!isStopKey(key)) return

    const now = Date.now()
    if (requested && firstPressAt !== null && now - firstPressAt < DOUBLE_PRESS_WINDOW_MS) {
      stream.write("[ridgeline] Graceful stop already pending — escalating to SIGINT.\n")
      onSecondPress()
      return
    }

    requested = true
    firstPressAt = now
    stream.write("[ridgeline] Graceful stop requested — will exit after the current phase finishes. Press again within 5s to abort immediately.\n")
  }

  input.on("keypress", handler)

  const uninstall = (): void => {
    input.off("keypress", handler)
    if (typeof stdinAsTTY.setRawMode === "function") {
      stdinAsTTY.setRawMode(previousRawMode)
    }
  }

  return {
    isRequested: () => requested,
    uninstall,
  }
}
