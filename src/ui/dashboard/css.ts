import { PALETTE, resolveAccents } from "./tokens"
import { rgbaOf } from "./hex"

export const renderCss = (): string => {
  const accents = resolveAccents()
  const byName = Object.fromEntries(accents.map((a) => [a.name, a]))

  const pillRunningText = byName.info.text
  const pillRunningFill = byName.info.fill
  const pillDoneText = byName.success.text
  const pillDoneFill = byName.success.fill
  const pillFailedText = byName.error.text
  const pillFailedFill = byName.error.fill
  const warningText = byName.warning.text
  const warningFill = byName.warning.fill
  const rowFlashColor = rgbaOf(PALETTE.info, 0.15)

  return `:root {
  --bg: ${PALETTE.bg};
  --panel: ${PALETTE.panel};
  --border: ${PALETTE.border};
  --text: ${PALETTE.text};
  --text-dim: ${PALETTE.textDim};
  --error: ${PALETTE.error};
  --success: ${PALETTE.success};
  --warning: ${PALETTE.warning};
  --info: ${PALETTE.info};
  --pill-running-text: ${pillRunningText};
  --pill-running-fill: ${pillRunningFill};
  --pill-done-text: ${pillDoneText};
  --pill-done-fill: ${pillDoneFill};
  --pill-failed-text: ${pillFailedText};
  --pill-failed-fill: ${pillFailedFill};
  --banner-text: ${warningText};
  --banner-fill: ${warningFill};
  --row-flash: ${rowFlashColor};
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  line-height: 1.4;
}

.page {
  max-width: 1280px;
  margin: 0 auto;
  padding: 16px;
}

.mono {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}

.dim {
  color: var(--text-dim);
}

.wordmark {
  font-size: 14px;
  color: var(--text-dim);
  font-weight: normal;
  text-transform: lowercase;
  letter-spacing: 0;
}

.header {
  position: sticky;
  top: 0;
  background: var(--bg);
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 16px;
  z-index: 10;
}

.build-name {
  font-size: 20px;
  color: var(--text);
  margin: 0;
  font-weight: normal;
  flex: 1;
}

.header-elapsed {
  font-size: 14px;
  color: var(--text-dim);
}

.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 12px;
  margin-top: 16px;
}

.cost-total {
  font-size: 20px;
}

.cost-label {
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 4px;
}

.cost-breakdown {
  margin-top: 12px;
  font-size: 13px;
  color: var(--text-dim);
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}

.cost-stage-value {
  color: var(--text);
}

.phase-list {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.phase-row {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 12px;
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 12px;
}

.phase-row.row-flash {
  animation: row-flash 300ms ease-out 1;
}

.phase-row.failed {
  border: 1px solid var(--error);
}

.phase-id {
  font-size: 13px;
  color: var(--text-dim);
}

.phase-slug {
  font-size: 14px;
  color: var(--text);
}

.phase-elapsed {
  font-size: 13px;
  color: var(--text-dim);
}

.phase-error {
  grid-column: 1 / -1;
  margin-top: 8px;
  font-size: 13px;
  color: var(--text);
}

.pill {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-weight: 600;
  border: 1px solid transparent;
}

.pill-pending,
.pill-skipped {
  color: var(--text-dim);
  background: var(--border);
}

.pill-running {
  color: var(--pill-running-text);
  background: var(--pill-running-fill);
  animation: pill-pulse 1500ms ease-in-out infinite;
}

.pill-done {
  color: var(--pill-done-text);
  background: var(--pill-done-fill);
}

.pill-failed {
  color: var(--pill-failed-text);
  background: var(--pill-failed-fill);
}

.empty {
  padding: 48px;
  text-align: center;
  color: var(--text-dim);
  font-size: 14px;
}

.empty-hint {
  margin-top: 8px;
  font-size: 13px;
}

.disconnect-banner {
  position: sticky;
  top: 0;
  z-index: 20;
  padding: 8px 12px;
  color: var(--banner-text);
  background: var(--banner-fill);
  border: 1px solid var(--warning);
  border-radius: 4px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.disconnect-banner.hidden {
  display: none;
}

.disconnect-banner.fade-out {
  animation: banner-fade 400ms ease-out forwards;
}

.spinner-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--info);
  animation: pill-pulse 1500ms ease-in-out infinite;
}

.icon {
  width: 16px;
  height: 16px;
  stroke-width: 1.5;
  stroke: currentColor;
  fill: none;
  vertical-align: middle;
}

.copy-btn,
.link-btn {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 4px;
}

.copy-btn:hover,
.link-btn:hover {
  color: var(--text);
}

a,
button {
  color: inherit;
}

a:focus-visible,
button:focus-visible,
.copy-btn:focus-visible,
.link-btn:focus-visible {
  outline: 2px solid var(--info);
  outline-offset: 2px;
}

@keyframes pill-pulse {
  0% { opacity: 0.6; }
  50% { opacity: 1; }
  100% { opacity: 0.6; }
}

@keyframes row-flash {
  0% { background-color: var(--row-flash); }
  100% { background-color: transparent; }
}

@keyframes banner-fade {
  0% { opacity: 1; }
  100% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .pill-running {
    animation: none;
    border: 2px solid var(--info);
    padding: 2px 6px;
  }
  .phase-row.row-flash {
    animation: none;
  }
  .spinner-dot {
    animation: none;
  }
  .disconnect-banner.fade-out {
    animation: none;
    display: none;
  }
}

@media (max-width: 900px) {
  .phase-row {
    grid-template-columns: 1fr;
  }
  .cost-breakdown {
    grid-template-columns: 1fr;
  }
}
`
}
