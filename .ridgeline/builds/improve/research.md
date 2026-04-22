# Research Findings

> Research for spec: ridgeline 0.8.0 — Flavour Collapse, Always-On Sensors, Lean Ensembles

## Active Recommendations

- **Rewrite the prompt-caching acceptance criteria.** The Claude CLI has no `--cache-breakpoint` / `--cache-control` flag; `cache_control` is an HTTP body directive that only the CLI itself emits. Replace the argv-assertion criterion with: (a) write the stable block (`constraints.md ‖ taste.md ‖ spec.md`) to a temp file passed via `--append-system-prompt-file`, (b) always include `--exclude-dynamic-system-prompt-sections` in `-p` invocations so per-machine sections (cwd, date, git status) don't poison the prefix, (c) leave the volatile handoff on stdin, (d) assert the stable file's bytes are identical across runs (not a slice of the assembled in-process prompt).
- **Couple the a11y sensor to Playwright.** axe-core requires a real DOM — JSDOM is documented as not supporting the `color-contrast` rule. Add `@axe-core/playwright` as a direct dependency (or inject `axe.min.js` via `page.addScriptTag({ path: require.resolve('axe-core') })` to avoid the non-SemVer wrapper). When Playwright is unresolvable, `a11y.ts` emits a warning `SensorFinding` rather than attempting a JSDOM fallback — same for `vision.ts` screenshot capture. The contrast sensor (which scores design-token hex pairs) stays independent of Playwright.
- **Specify the `shape.md` `devServerPort` format.** `src/commands/shape.ts:14-172` writes pure Markdown from `SHAPE_OUTPUT_SCHEMA` with no front matter. Add an optional `runtime.devServerPort?: number` to the schema and render a new trailing `## Runtime` section with `- **Dev server port:** 5173`. The Playwright sensor parses that section with a single regex; malformed or missing falls through to the existing probe list.
- **Specify a deterministic brightening algorithm.** `wcag-contrast` is measurement-only; the "brightened if short" requirement needs a named algorithm. Convert the accent hex to HSL, composite the 10%-opacity fill over `#0B0F14` to get the effective pixel color, step L upward in 2% increments (capped at L=95–98%) until `hex(text, effectiveFill) >= 4.5`, falling back to `--text #E5E7EB` on failure. Bake the adjusted hex values into served CSS at build time rather than computing at page load.
- **Name the SSE event types and schema.** `/events` should emit three named events (`event: state`, `event: budget`, `event: trajectory`) each carrying one-line JSON `data:`, a monotonic `id:` for `Last-Event-ID` reconnect recovery, and a `retry: 2000` directive at stream open. Send a `: heartbeat\n\n` comment every 15–25 s. Response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
- **Codify specialist subprocess timeouts and quorum.** `src/engine/claude/claude.exec.ts` already implements startup/stall timeouts with SIGTERM→SIGKILL escalation. Add an explicit criterion under "Default 2-specialist ensembles": timed-out specialists count as failures for quorum (identical to non-zero exit); add a vitest that resolves one specialist and times out the other, asserting synthesis runs on the survivor. If both (or all three under `--thorough`) fail or time out, the ensemble halts.
- **Pin the Playwright peerDep range.** Use `"playwright": ">=1.57.0 <2.0.0"` with `peerDependenciesMeta: { "playwright": { "optional": true } }`. Rationale: 1.57 is where Chrome-for-Testing landed and where `page.accessibility` removal made axe-core the blessed a11y path; anything older drags in ancient selectors/sandbox behavior that don't match current docs.
- **Set `engines.node` to `>=20.0.0`.** Current `package.json` has no `engines` field. Playwright 1.57+ deprecates Node 18; Node 20 is LTS through mid-2026 and matches the `@types/node@22` dev-time baseline. Add to the Breaking section of the CHANGELOG.
- **Extend the Playwright install hint.** `npm install --save-dev playwright` alone leaves the user one step short — browser binaries require `npx playwright install chromium` (~150 MB). Update preflight's install hint to `npm install --save-dev playwright && npx playwright install chromium`. The Playwright sensor should catch "browser not found" on first launch and emit a warning finding pointing at the same command.
- **Handle the sandbox / Chromium launch interaction.** Running Chromium inside Greywall/bwrap frequently requires `--no-sandbox` and `--disable-setuid-sandbox`. Pass those launch args by default when a sandbox environment is detected (env var check), with a 10 s launch timeout; on failure, emit the warning finding and continue rather than hard-abort.
- **Drop the client-side cache-key concept entirely.** Anthropic's prefix cache is server-side content-hashed; ridgeline does not need `.ridgeline/cache-key.json` or any persisted hash. Optional: log a `sha256` of the concatenated stable files into `trajectory.jsonl` purely for diagnostics (correlate cache behavior with stable-block edits). Note the 5-minute default TTL — cross-invocation hits past 5 minutes are best-effort; 1-hour TTL costs 2× write and isn't worth enabling for a local CLI.
- **Surface cache telemetry for testability.** With `--output-format json`, the CLI emits `cache_creation_input_tokens` and `cache_read_input_tokens`. Log these to `trajectory.jsonl` so the "caching is working" claim is measurable. Also warn at preflight when the combined stable block is under 4,096 tokens (the Opus-family minimum cacheable prefix) — Sonnet is 2,048.
- **Simplify favicon debouncing.** Replace "debounced to once per actual status change" with "the favicon `href` is only reassigned when the mapped color actually changes (last-value compared)." Browsers no-op identical data-URI assignments; a `setTimeout` debounce is unnecessary.
- **Watch state files efficiently.** For `state.json` / `budget.json`, use `fs.watch` with 50 ms debounce and a changed-value diff. For `trajectory.jsonl`, track a byte offset and seek-read appended lines — don't re-read the whole file on every append. `fs.watchFile` polling defaults to 5 s (slower than the 2 s polling fallback) and should be avoided.

## Findings Log

### Iteration 1 — 2026-04-21

#### Claude CLI has no cache-control argv flag

**Source:** <https://code.claude.com/docs/en/cli-reference> ; <https://platform.claude.com/docs/en/build-with-claude/prompt-caching> ; <https://github.com/cline/cline/discussions/9892> ; <https://www.claudecodecamp.com/p/how-prompt-caching-actually-works-in-claude-code> ; Claude Code 2.1.98 changelog
**Perspective:** Convergent — all three specialists (academic, competitive, ecosystem)
**Relevance:** The spec's acceptance criterion "the prompt emitted to the Claude CLI passes this via the documented caching flag (verified by inspecting the argv of the spawned subprocess in a stub)" is untestable as written. `cache_control` lives in the HTTP body, which only the CLI constructs. Auto-caching is on by default; the only exposed knob in the direction the spec wants is `--exclude-dynamic-system-prompt-sections` (introduced in Claude Code 2.1.98), which demotes per-machine sections out of the system prompt so identical configurations share a cache entry. The competitive specialist additionally notes current code at `src/engine/claude/claude.exec.ts:102` already uses `--append-system-prompt`; the ecosystem specialist notes `--append-system-prompt-file <path>` is the cleaner form.
**Recommendation:** Rewrite acceptance criteria: (1) stable content goes to a temp file loaded via `--append-system-prompt-file`; (2) `--exclude-dynamic-system-prompt-sections` is passed when running `-p`; (3) assert byte-identity on the *file contents*, not on an in-process slice; (4) detect `--exclude-dynamic-system-prompt-sections` availability via CLI `--help` at startup and no-op if absent.

#### Cline discovered dynamic header prefix busts cache across subprocess spawns

**Source:** <https://github.com/cline/cline/discussions/9892>
**Perspective:** Academic specialist
**Relevance:** Every new Claude Code CLI subprocess emits a changing `cc_version=...;cch=...;` header prefix that busts the server-side prefix cache between invocations. ridgeline's spawn-per-phase model currently gets no cross-invocation cache reuse at all regardless of prompt ordering.
**Recommendation:** Consider a session-continuity strategy — `--resume <session_id>` + `-p`, or keep a persistent subprocess with `--input-format stream-json`. This is a deeper change than the flag swap and may exceed 0.8.0 scope; at minimum, document the limitation in the spec so future work is scoped correctly.

#### Minimum cacheable prefix threshold

**Source:** <https://platform.claude.com/docs/en/build-with-claude/prompt-caching>
**Perspective:** Academic specialist
**Relevance:** Opus 4.x/4.5/4.6/4.7 and Haiku 4.5 require a 4,096-token minimum cacheable prefix; Sonnet 4.6 requires 2,048. If the combined stable block is below the threshold, caching is silently skipped.
**Recommendation:** Add an acceptance criterion that preflight measures the combined stable-block token count and warns if under 4,096 for Opus-family models. Use `--output-format json` to surface `cache_creation_input_tokens` / `cache_read_input_tokens` in trajectory logs for measurability.

#### Cache invalidation is server-side content-hash; no client-side state needed

**Source:** <https://platform.claude.com/docs/en/build-with-claude/prompt-caching> ; <https://www.claudecodecamp.com/p/how-prompt-caching-actually-works-in-claude-code>
**Perspective:** Convergent — all three specialists
**Relevance:** The cache is keyed on cumulative cryptographic hashes of the prefix in `tools → system → messages` order. Default TTL 5 min, 1h TTL available at 2× write cost. ridgeline does not need to persist any cache key or implement an invalidation layer. The spec's current criterion "Editing constraints.md, taste.md, or spec.md between runs invalidates the cache on the next run" is automatically true — bytes change, hash changes, miss happens. Not independently testable without hitting a real API.
**Recommendation:** Drop any `.ridgeline/cache-key.json` or mtime-based tracking. Reword the invalidation criterion to state invalidation is delegated to the upstream API. Optionally log a local `sha256` of concatenated stable files for diagnostics only.

#### axe-core requires a browser DOM; JSDOM drops color-contrast rule

**Source:** <https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md> ; <https://github.com/dequelabs/axe-core/issues/1167> ; <https://github.com/dequelabs/axe-core/issues/1417> ; <https://www.npmjs.com/package/jest-axe>
**Perspective:** Convergent — all three specialists
**Relevance:** axe-core explicitly requires `window`/`document` globals. JSDOM is a fallback but disables the `color-contrast` rule — a primary reason ridgeline wants a11y sensors. The spec's framing of four independent sensors is inaccurate: a11y (and any screenshot-based vision check) depend on the Playwright browser. `@axe-core/playwright` exposes `new AxeBuilder({ page }).analyze()` and auto-injects into all frames.
**Recommendation:** Treat `a11y.ts` as a consumer of the Playwright sensor's `Page`, not a peer. When Playwright is unresolvable (peerDep missing or sandbox blocks browser), a11y emits a warning `SensorFinding` with install hint; do not fall back to JSDOM. Two implementation choices: (a) add `@axe-core/playwright` as a direct dep and use `AxeBuilder`; (b) add `axe-core` alone and inject via `page.addScriptTag({ path: require.resolve('axe-core') })` to dodge the non-SemVer wrapper (see below).

#### @axe-core/playwright versioning is non-SemVer

**Source:** <https://www.npmjs.com/package/@axe-core/playwright> ; <https://deepwiki.com/dequelabs/axe-core-npm/2.2.3-playwright-integration-(@axe-coreplaywright>)
**Perspective:** Ecosystem specialist
**Relevance:** `@axe-core/playwright` tracks axe-core's major.minor rather than SemVer — a `^4.11.0` range can bundle different axe-core minors across patch releases. This subverts normal dep-lock expectations.
**Recommendation:** Either pin exactly / use `~4.11.x`, or prefer direct axe-core injection (`axe-core` as dep, `page.addScriptTag({ path: require.resolve('axe-core') })`) for predictable versioning. Competitive/academic specialists split on preference — ecosystem favors direct injection, academic favors the wrapper. Recommend direct injection to keep the dep tree flat and avoid the non-SemVer gotcha.

#### Playwright 1.59 current; pin peerDep to >=1.57 <2.0

**Source:** <https://playwright.dev/docs/release-notes> ; <https://testdino.com/blog/playwright-2026-new-features/> ; <https://medium.com/@szaranger/playwright-1-57-the-must-use-update-for-web-test-automation-in-2025-b194df6c9e03>
**Perspective:** Convergent — all three specialists
**Relevance:** Latest stable is 1.59.1 (April 2026). Breaking changes in the 1.55–1.59 range: `_react`/`_vue` selectors removed (1.58), `page.accessibility` removed (users redirected to axe-core), Chromium Extension MV2 dropped, Chrome-for-Testing adopted (1.57). None affect ridgeline's usage (screenshot + axe injection + DOM eval). Node 18 deprecated by Playwright as of 1.54.
**Recommendation:** `"playwright": ">=1.57.0 <2.0.0"` as an optional peerDep (`peerDependenciesMeta`). Update preflight install hint to include `@^1.57`.

#### Playwright browser binaries require separate install step

**Source:** <https://playwright.dev/docs/intro> ; <https://playwright.dev/docs/browsers>
**Perspective:** Ecosystem specialist
**Relevance:** `npm install --save-dev playwright` installs the JS package but not browser binaries (~150 MB for chromium). The spec's preflight install hint `npm install --save-dev playwright` leaves the user one step short.
**Recommendation:** Preflight hint becomes `npm install --save-dev playwright && npx playwright install chromium`. The Playwright sensor catches "browser not found" on first launch and emits a warning finding with the same command.

#### Playwright + Greywall/bwrap sandbox interaction

**Source:** <https://playwright.dev/docs/intro> ; <https://chromium.googlesource.com/chromium/src/+/main/docs/linux/sandboxing.md>
**Perspective:** Academic specialist
**Relevance:** Spec promises graceful warning degradation when bwrap blocks browser launch, but Playwright's Chromium inside bwrap frequently needs `--no-sandbox` / `--disable-setuid-sandbox` (nested sandbox). Without explicit launch args, expect hard failure, not graceful degradation.
**Recommendation:** Pass `launchOptions: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }` by default when a sandbox environment is detected (env var check). 10 s launch timeout; on failure, emit warning finding and continue. Document in the sandboxing doc.

#### shape.md has no front matter; devServerPort needs a new section convention

**Source:** Codebase — `src/commands/shape.ts:14-53` (`SHAPE_OUTPUT_SCHEMA`) and `src/commands/shape.ts:99-172` (`formatShapeMd`)
**Perspective:** Convergent — academic and competitive specialists (ecosystem defers to codebase inspection, converges on same conclusion)
**Relevance:** Existing shape.md is pure Markdown with six sections (`## Intent`, `## Scope`, `## Solution Shape`, `## Risks & Complexities`, `## Existing Landscape`, `## Technical Preferences`). No YAML front matter. Parsing a top-level `devServerPort: 5173` line is ambiguous with bullet content.
**Recommendation:** Extend `SHAPE_OUTPUT_SCHEMA` with an optional `runtime.devServerPort?: number` field. Render as a new trailing `## Runtime` section with `- **Dev server port:** 5173` (matches existing bullet style). Parse with `^\s*-\s*\*\*Dev server port:\*\*\s+(\d+)\s*$`. Malformed or missing falls through to the existing probe list (`5173`, `3000`, `8080`, `4321`). Consider this consensus over the ecosystem specialist's YAML-front-matter alternative (which breaks the project's markdown convention).

#### wcag-contrast is measurement-only; no brightening helper

**Source:** <https://github.com/tmcw/wcag-contrast> ; <https://www.npmjs.com/package/wcag-contrast> ; <https://www.npmjs.com/package/color-contrast-calc> ; <https://accessiblepalette.com/> ; <https://www.npmjs.com/package/accessible-colors>
**Perspective:** Convergent — all three specialists
**Relevance:** `wcag-contrast` exports only `luminance`, `rgb`, `hex`, `score` — no `lighten`, no `adjustToContrast`. The spec's "brightened if short" is underspecified. Implementors will silently pick HSL vs OKLCH vs APCA, producing different palettes for the same input.
**Recommendation:** Specify a hand-rolled HSL lightness stepper (~20 lines) in `src/ui/contrast.ts`. Algorithm: parse hex → HSL → composite 10%-opacity fill over `#0B0F14` → iterate L upward in 2% steps (cap L=95–98%) → re-measure with `wcag-contrast.hex` until `>= 4.5`. Fall back to `--text #E5E7EB` if the loop caps. Bake adjusted values into served CSS at build time (palette is fixed). Add a vitest that `#06B6D4` on `#06B6D41A`-over-`#0B0F14` already clears 4.5:1 with no adjustment (~7.5:1), so the loop is a fallback for future accent edits.

#### Node subprocess spawn() has no built-in timeout

**Source:** <https://nodejs.org/api/child_process.html> ; <https://github.com/nodejs/node/issues/27639> ; <https://github.com/nodejs/node/issues/51561> ; <https://medium.com/@almenon214/killing-processes-with-node-772ffdd19aad> ; `src/engine/claude/claude.exec.ts:1-214`
**Perspective:** Convergent — all three specialists
**Relevance:** Spec defines quorum for failed specialists but not "failure" for a hung Claude CLI. `spawn()`'s `timeout` option uses SIGTERM by default; trapped SIGTERM hangs indefinitely. Competitive specialist found the infrastructure already exists in `claude.exec.ts` (startup/stall/global timeouts, SIGTERM + 5 s SIGKILL escalation, typed rejections, `liveProcs` tracking).
**Recommendation:** Add explicit acceptance criterion under "Default 2-specialist ensembles": specialist subprocess timeouts (startup, stall, global) count as failures for quorum resolution — rejection from `invokeClaude` is treated identically to non-zero exit. Add a vitest stub that times out one specialist and asserts synthesis runs on the survivor. Default per-call timeout 180–600 s (recommend 180 s for spec/plan calls, configurable via `settings.json`). Log timeouts to `trajectory.jsonl` with `reason: "timeout"`.

#### SSE schema — named events, JSON data, heartbeat, id for reconnect

**Source:** <https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events> ; <https://html.spec.whatwg.org/multipage/server-sent-events.html> ; <https://www.speakeasy.com/openapi/content/server-sent-events> ; <https://tigerabrodi.blog/server-sent-events-a-practical-guide-for-the-real-world> ; <https://1xapi.com/blog/implement-server-sent-events-sse-nodejs-2026> ; <https://datto.engineering/post/powering-a-live-ui-with-server-sent-events>
**Perspective:** Convergent — all three specialists
**Relevance:** Spec says `/events` "emits at least one `data:` line" but doesn't specify event names, heartbeat cadence, or reconnection semantics. Dashboard JS needs a schema.
**Recommendation:** Three named events: `event: state`, `event: budget`, `event: trajectory`. Each event carries `id: <monotonic>` (enables `Last-Event-ID` reconnect), compact one-line JSON `data:`. `retry: 2000` once at stream open to match the 2 s polling cadence. `: heartbeat\n\n` comment every 15–25 s to keep proxies from closing idle connections. Response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`. ~40 lines on top of Node's built-in `http`; no `eventsource` / `sse-express` dep needed.

#### Efficient state-file watching for the dashboard

**Source:** <https://nodejs.org/api/fs.html#fswatchfilename-options-listener>
**Perspective:** Academic specialist
**Relevance:** `fs.watch` on macOS is per-file and fires spurious events; `trajectory.jsonl` grows append-only. `fs.watchFile` polling defaults to 5 s — slower than the 2 s polling fallback, which defeats SSE's purpose.
**Recommendation:** For `state.json` / `budget.json` (atomic rewrites): `fs.watch` with 50 ms debounce, re-read on change, diff against last value, emit only if changed. For `trajectory.jsonl`: persistent read stream with byte-offset tracking; `fs.watch` triggers a seek-to-offset read of new lines. Do not re-read the whole file on every append.

#### Set engines.node to >=20.0.0 (or >=22)

**Source:** Playwright release notes (Node 18 deprecated in 1.54) ; `package.json` has no `engines` field today ; `@types/node@22.19.17` in devDependencies
**Perspective:** Convergent — all three specialists (academic says ≥20, competitive says ≥22, ecosystem says ≥20)
**Relevance:** No current `engines` field. Playwright deprecates Node 18. axe-core trivially satisfied. Node's built-in `http` supports SSE flush on any modern version. Competitive specialist argues for 22 because `@types/node@22` is the dev baseline and Node 22 ships stable `node:test`; academic/ecosystem argue for 20 because it's current LTS through mid-2026.
**Recommendation:** Set `engines.node: ">=20.0.0"` as the conservative consensus — LTS, covers Playwright's active-support floor, doesn't shut out users on recent-but-not-cutting-edge runtimes. Document in CHANGELOG Breaking section. Revisit to 22 if a future feature requires it.

#### Favicon swap simplification

**Source:** <https://developer.mozilla.org/en-US/docs/Web/HTML/Element/link> ; <https://html.spec.whatwg.org/multipage/links.html#rel-icon>
**Perspective:** Ecosystem specialist
**Relevance:** Spec says favicon swap is "debounced to once per actual status change." Browsers no-op identical data-URI assignments automatically — no time-based debounce needed.
**Recommendation:** Replace with "the favicon `href` is only reassigned when the mapped color actually changes (last-value compared)." Cleaner to implement and test; matches spec intent.

## Sources

1. <https://code.claude.com/docs/en/cli-reference>
2. <https://code.claude.com/docs/en/headless>
3. <https://platform.claude.com/docs/en/build-with-claude/prompt-caching>
4. <https://github.com/cline/cline/discussions/9892>
5. <https://www.claudecodecamp.com/p/how-prompt-caching-actually-works-in-claude-code>
6. <https://x.com/ClaudeCodeLog/status/2042327135696601243>
7. <https://www.aifreeapi.com/en/posts/claude-api-prompt-caching-guide>
8. <https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md>
9. <https://www.npmjs.com/package/@axe-core/playwright>
10. <https://deepwiki.com/dequelabs/axe-core-npm/2.2.3-playwright-integration-(@axe-coreplaywright>)
11. <https://github.com/dequelabs/axe-core/issues/1167>
12. <https://github.com/dequelabs/axe-core/issues/1417>
13. <https://github.com/dequelabs/axe-core/blob/develop/package.json>
14. <https://www.npmjs.com/package/axe-core>
15. <https://github.com/marcysutton/jsdom-axe>
16. <https://www.npmjs.com/package/jest-axe>
17. <https://www.npmjs.com/package/playwright>
18. <https://playwright.dev/docs/release-notes>
19. <https://playwright.dev/docs/intro>
20. <https://playwright.dev/docs/browsers>
21. <https://github.com/microsoft/playwright/blob/main/packages/playwright/package.json>
22. <https://testdino.com/blog/playwright-2026-new-features/>
23. <https://medium.com/@szaranger/playwright-1-57-the-must-use-update-for-web-test-automation-in-2025-b194df6c9e03>
24. <https://chromium.googlesource.com/chromium/src/+/main/docs/linux/sandboxing.md>
25. <https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events>
26. <https://html.spec.whatwg.org/multipage/server-sent-events.html>
27. <https://www.speakeasy.com/openapi/content/server-sent-events>
28. <https://tigerabrodi.blog/server-sent-events-a-practical-guide-for-the-real-world>
29. <https://1xapi.com/blog/implement-server-sent-events-sse-nodejs-2026>
30. <https://datto.engineering/post/powering-a-live-ui-with-server-sent-events>
31. <https://nodejs.org/api/child_process.html>
32. <https://nodejs.org/api/fs.html#fswatchfilename-options-listener>
33. <https://github.com/nodejs/node/issues/27639>
34. <https://github.com/nodejs/node/issues/51561>
35. <https://medium.com/@almenon214/killing-processes-with-node-772ffdd19aad>
36. <https://github.com/tmcw/wcag-contrast>
37. <https://www.npmjs.com/package/wcag-contrast>
38. <https://www.npmjs.com/package/color-contrast-calc>
39. <https://www.npmjs.com/package/accessible-colors>
40. <https://socket.dev/npm/package/color-contrast-picker>
41. <https://accessiblepalette.com/>
42. <https://developer.mozilla.org/en-US/docs/Web/HTML/Element/link>
43. <https://html.spec.whatwg.org/multipage/links.html#rel-icon>
