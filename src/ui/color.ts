const ESC = String.fromCharCode(27)
const SGR = (code: string): string => `${ESC}[${code}m`
const RESET = SGR("0")

const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g")

const CODE_ERROR = "31"
const CODE_SUCCESS = "32"
const CODE_WARNING = "33"
const CODE_INFO = "36"
const CODE_DIM = "2"
const CODE_BOLD = "1"

export type ColorStream = "stdout" | "stderr"

type WrapOpts = { stream?: ColorStream; force?: boolean }

const streamOf = (s: ColorStream): NodeJS.WriteStream =>
  s === "stderr" ? process.stderr : process.stdout

export const isColorEnabled = (stream: ColorStream = "stdout"): boolean => {
  const noColor = process.env.NO_COLOR
  if (noColor !== undefined && noColor !== "") return false
  return Boolean(streamOf(stream).isTTY)
}

const wrap = (open: string, text: string, opts?: WrapOpts): string => {
  const enabled = opts?.force ?? isColorEnabled(opts?.stream ?? "stdout")
  if (!enabled) return text
  return `${SGR(open)}${text}${RESET}`
}

export const error = (text: string, opts?: WrapOpts): string =>
  wrap(CODE_ERROR, text, opts)

export const success = (text: string, opts?: WrapOpts): string =>
  wrap(CODE_SUCCESS, text, opts)

export const warning = (text: string, opts?: WrapOpts): string =>
  wrap(CODE_WARNING, text, opts)

export const info = (text: string, opts?: WrapOpts): string =>
  wrap(CODE_INFO, text, opts)

export const hint = (text: string, opts?: WrapOpts): string =>
  wrap(CODE_DIM, text, opts)

export const bold = (text: string, opts?: WrapOpts): string =>
  wrap(CODE_BOLD, text, opts)

export const dimInfo = (text: string, opts?: WrapOpts): string =>
  wrap(`${CODE_DIM};${CODE_INFO}`, text, opts)

export const stripAnsi = (text: string): string => text.replace(ANSI_PATTERN, "")

export const clearLineSequence = (): string => `\r${ESC}[K`
