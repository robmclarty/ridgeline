import { PALETTE } from "./tokens"

export type FaviconStatus = "running" | "done" | "failed" | "idle"

const COLOR_BY_STATUS: Record<FaviconStatus, string> = {
  running: PALETTE.info,
  done: PALETTE.success,
  failed: PALETTE.error,
  idle: PALETTE.textDim,
}

const faviconSvg = (status: FaviconStatus): string => {
  const fill = COLOR_BY_STATUS[status]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="${fill}"/></svg>`
}

export const faviconDataUri = (status: FaviconStatus): string => {
  const svg = faviconSvg(status)
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
