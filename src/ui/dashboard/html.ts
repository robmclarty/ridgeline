import { renderCss } from "./css"
import { renderClientScript } from "./client"
import { faviconDataUri } from "./favicon"
import type { DashboardSnapshot } from "./snapshot"

export interface RenderHtmlOptions {
  buildName: string | null
  port: number
  snapshot: DashboardSnapshot
}

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

export const renderHtml = (opts: RenderHtmlOptions): string => {
  const { buildName, port, snapshot } = opts
  const title = buildName
    ? `● ridgeline · ${buildName} · ${snapshot.status ?? "idle"}`
    : "● ridgeline"
  const favicon = faviconDataUri(snapshot.status === "running"
    ? "running"
    : snapshot.status === "failed"
      ? "failed"
      : snapshot.status === "done"
        ? "done"
        : "idle")

  const bootstrap = JSON.stringify({ buildName, port, snapshot })

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link id="favicon" rel="icon" href="${favicon}" type="image/svg+xml">
<style>
${renderCss()}</style>
</head>
<body>
<div class="page">
  <div id="disconnect-banner" class="disconnect-banner hidden" role="status" aria-live="polite">
    <span class="spinner-dot" aria-hidden="true"></span>
    <span>Disconnected from ridgeline process. Retrying…</span>
  </div>
  <header class="header">
    <h1 id="build-name" class="build-name">${buildName ? escapeHtml(buildName) : "ridgeline"}</h1>
    <span id="header-elapsed" class="header-elapsed mono"></span>
    <span id="header-pill" class="pill pill-pending">pending</span>
    <span class="wordmark">ridgeline</span>
  </header>
  <main id="main">
    <section id="empty-state" class="panel empty" ${buildName ? 'hidden' : ''}>
      <div>No build attached. Run <span class="mono">ridgeline &lt;name&gt; "intent"</span> in another terminal, then reload.</div>
      <div class="empty-hint mono">http://127.0.0.1:${port}</div>
    </section>
    <section id="cost-meter" class="panel" ${buildName ? '' : 'hidden'}>
      <div class="cost-label">Total cost</div>
      <div id="cost-total" class="cost-total mono">$0.00</div>
      <div id="cost-breakdown" class="cost-breakdown"></div>
    </section>
    <section id="phase-list" class="phase-list" aria-label="Phases"></section>
  </main>
</div>
<script id="bootstrap" type="application/json">${bootstrap.replace(/</g, "\\u003c")}</script>
<script>
${renderClientScript()}</script>
</body>
</html>
`
}
