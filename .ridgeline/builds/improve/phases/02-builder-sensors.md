---
depends_on: [01b-detection-preflight-color]
---
# Phase 2: Always-on builder sensors and dev-server port convention

## Goal

Give the builder agent eyes. Ship `src/sensors/` as four uniform adapters — Playwright (screenshot + DOM evaluation, the browser substrate), Claude vision (image analysis via the existing Claude CLI path), axe-core (accessibility audit run against a Playwright `Page`), and `wcag-contrast` (contrast ratio checks on static design-token hex pairs, independent of Playwright). Wire the builder prompt (`src/agents/core/builder.md`) to reference all four sensors and describe the visual self-verification pattern. Add the `shape.md` `## Runtime` dev-server-port convention the Playwright sensor reads.

When the phase completes: the builder tool registry declares all four sensors unconditionally; runtime availability is gated by the `DetectionReport.suggestedSensors` (from phase 1b) plus peer-dependency resolvability. Sensor failures are non-fatal warnings — the builder continues blind. When Playwright is unresolvable or Chromium is missing, `a11y` and `vision` emit a warning with the one-command install hint and return; the contrast sensor stays independent of Playwright. Sandbox compatibility is handled explicitly (Chromium launch args, 10 s timeout, `sandbox-incompatible` warning). Dev-server discovery either reads the `## Runtime` section of `shape.md` or probes `5173`, `3000`, `8080`, `4321` in order with a 250 ms per-probe cap and 1 s overall cap.

This is a self-contained surface — none of the orchestration / verdict / caching changes (phase 3) depend on the sensors except through the `SensorFinding` type, which this phase exports.

## Context

Phase 1a deleted `src/flavours/`, rewired `agent.registry.ts` to resolve from `src/agents/` only, declared `playwright` as an optional peer dependency, added `axe-core` and `wcag-contrast` as direct dependencies, and bumped to `0.8.0` with `engines.node: ">=20.0.0"`. Phase 1b shipped the project-signal scanner (`detect`), `runPreflight`, and the semantic color helper. Neither phase 1a nor 1b added the conditional Playwright install hint to preflight; that is added here so it can be tested alongside the resolution probe.

`src/agents/core/builder.md` exists and currently makes no reference to sensors. `src/commands/shape.ts` defines `SHAPE_OUTPUT_SCHEMA` and `formatShapeMd` at lines 14–172; `shape.md` has no YAML front matter today, so this phase uses a dedicated `## Runtime` section matching the existing bullet style, not a top-level YAML key.

The reviewer's structured verdict gains a `sensorFindings: SensorFinding[]` field in phase 3; this phase's job is only to export the `SensorFinding` type and to wire collection into the builder loop. The reviewer-side rendering of "Sensor Findings" markdown sections is phase 3's job.

## Acceptance Criteria

### Module shape and types

1. `src/sensors/` exists and contains exactly five files: `playwright.ts`, `vision.ts`, `a11y.ts`, `contrast.ts`, and `index.ts`. No additional files.
2. `SensorFinding` interface is exported from `src/sensors/index.ts` (or re-exported from there) with exactly the shape `{ kind: 'screenshot' | 'a11y' | 'contrast' | 'vision', path?: string, summary: string, severity: 'info' | 'warning' | 'error' }`.
3. Each sensor module default-exports an adapter object with at minimum `{ name: string, run(input): Promise<SensorFinding[]> }` and an explicit TypeScript return type.

### axe-core integration

4. `axe-core` is injected into the Playwright `Page` via `page.addScriptTag({ path: require.resolve('axe-core') })` rather than depending on `@axe-core/playwright`. `@axe-core/playwright` is NOT a dependency (verified by grep on `package.json` and lockfile).
5. axe-core runs locally against the project's rendered output with zero outbound network requests (asserted by an offline test that stubs network access).

### Claude vision integration

6. The Claude vision sensor routes screenshots through the existing Claude CLI subprocess path (same auth/trust boundary as other agent calls). It does not introduce a separate API client.

### Sandbox compatibility

7. When a sandbox environment is detected (Greywall env marker on macOS, `BWRAP_DETECTED` or equivalent on Linux), Playwright launches Chromium with `launchOptions.args = ['--no-sandbox', '--disable-setuid-sandbox']` and a 10-second launch timeout.
8. On Chromium launch failure or timeout, the Playwright sensor emits a warning `SensorFinding` whose `summary` contains the literal phrase `sandbox-incompatible` and the phase continues, not aborts.

### Peer-dependency degradation

9. When `require.resolve('playwright')` throws or `browserType.launch()` reports `browser not found` on first call, `a11y.ts` and `vision.ts` each emit a warning `SensorFinding` with `summary` containing the literal substring `npm install --save-dev playwright && npx playwright install chromium` and return without attempting a JSDOM fallback. `contrast.ts` is unaffected (it scores static hex pairs).
10. The Playwright sensor itself, when unresolvable, also returns a warning `SensorFinding` (not a thrown error) so the builder phase continues.

### Builder integration

11. `src/agents/core/builder.md` references all four sensors by name and describes the visual self-verification pattern.
12. The builder tool registry declares the four sensors unconditionally; availability at runtime is gated by `DetectionReport.suggestedSensors` (from phase 1) + peer-dependency resolvability, not by an opt-in flag. No sensor-specific CLI flag is added.
13. When a sensor throws (synchronous throw or rejected promise), the builder phase logs a single `warn`-level line containing the sensor name and continues; the phase does not abort. A vitest stubs a sensor to reject and asserts phase status `done`.
14. Sensor execution happens inside the existing sandbox (Greywall on macOS, bwrap on Linux); no sandbox provider changes.

### Preflight install-hint integration

15. When `DetectionReport.isVisualSurface === true` and `require.resolve('playwright')` throws, preflight stdout (from phase 1b's `runPreflight`) contains the literal substring `npm install --save-dev playwright && npx playwright install chromium` (both halves on the same line) and the reason phrase `visual surface detected`. A vitest covers this with `playwright` stubbed as unresolvable.

### shape.md `## Runtime` convention

16. `SHAPE_OUTPUT_SCHEMA` in `src/commands/shape.ts` gains an optional `runtime?: { devServerPort?: number }` field.
17. `formatShapeMd` renders a new trailing `## Runtime` section when `runtime.devServerPort` is set. Rendered line format, literal: `- **Dev server port:** 5173` (bold label, space, integer, no trailing punctuation).
18. When `runtime` is absent or empty, the `## Runtime` section is omitted entirely (no empty heading).
19. YAML front matter is explicitly NOT used for this declaration — preserves the project's pure-Markdown shape.md convention.

### Dev-server port discovery

20. The Playwright sensor parses the port using the regex `/^\s*-\s*\*\*Dev server port:\*\*\s+(\d+)\s*$/m` anchored to a line within a `## Runtime` heading block. On a successful match, the port is used directly with no probing.
21. When the `## Runtime` section is absent or the regex does not match, the sensor probes `5173`, `3000`, `8080`, `4321` in that exact order with a 250 ms timeout per probe (HTTP HEAD), using the first that returns any HTTP status.
22. Total probe time is capped at 1 second; if no probe succeeds, the sensor emits a `SensorFinding` with `severity: 'warning'` and `summary` containing `no dev server detected`, and the phase continues.
23. No other ports are probed (verified by a vitest that asserts the probe call list).
24. Malformed port declaration (non-numeric, out of range `[1, 65535]`, or multiple `## Runtime` sections) falls back to probing with a warn-level log line; parse errors never throw.

### Tests

25. Each of the four sensor adapters has a vitest unit test with stubbed I/O.
26. A vitest covers the dev-server port regex match (port used directly) and the probe fallback (correct call list and order).
27. A vitest stubs `require.resolve('playwright')` to throw and asserts the install-hint message in both the `a11y`/`vision` warnings and the preflight output.
28. A vitest stubs Chromium launch to time out and asserts the `sandbox-incompatible` warning.

### Check command

29. The check command from `constraints.md` (`npm run lint && npm test && npx tsc --noEmit`) exits 0 at the end of this phase.

## Spec Reference

Drawn from `spec.md`:

- **Always-on builder sensors** (entire section)
- **Dev-server port convention for Playwright** (entire section)
- **Vitest coverage for new code paths** — item (f) (each of the four sensor adapters with stubbed I/O)
- **Preflight detection summary and TTY gate** — only the install-hint clause that depends on `require.resolve('playwright')`

Drawn from `constraints.md`:

- Sandboxing and Security
- Dependencies (the `playwright` peer dep and `axe-core` / `wcag-contrast` direct deps were declared in phase 1a; this phase wires them up)
