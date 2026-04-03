# Output System

Ridgeline streams LLM assistant text to stdout in real time, visually separated from harness log lines by blank lines.

## What it looks like

```
[ridgeline] [04-tests] Building...

Now let me read the actual file contents I need for implementation.
Now I have full context. Let me implement all three tasks.
All 74 tests pass and typecheck is clean. Now build and verify.
Phase 4 complete.

[ridgeline] [04-tests] Reviewing...

Checking git diff against checkpoint...
All acceptance criteria verified.

[ridgeline] [04-tests] PASSED (129s)
```

Harness lines use the `[ridgeline] [phase] action` format. LLM output appears between them with a blank line before and after.

## Architecture

Four modules with distinct responsibilities:

```
streamParser.ts    — parse NDJSON, extract results (pure functions, no I/O)
claudeInvoker.ts   — spawn claude subprocess, collect output, call callbacks
buildInvoker.ts    — assemble prompts, wire up display, call invoker
  (and reviewInvoker, planInvoker, spec)
phaseRunner.ts     — orchestrate phases, own the [ridgeline] log lines
```

### streamParser.ts

Pure functions, fully testable, no side effects.

- `parseStreamLine(line)` — parse one NDJSON line into a `StreamEvent`: `{ type: "text", text }`, `{ type: "result", result: ClaudeResult }`, or `{ type: "other" }`.
- `createStreamHandler(onEvent)` — returns a `(chunk: string) => void` that buffers partial lines across chunks and calls `onEvent` for each complete parsed line.
- `extractResult(ndjsonStdout)` — scans accumulated stdout backward for the `type: "result"` event and returns a parsed `ClaudeResult`.
- `createDisplayCallbacks()` — convenience function that wires up a stream handler to write assistant text to `process.stdout` with blank line padding. Returns `{ onStdout, flush }`.

### claudeInvoker.ts

Generic subprocess runner. No display logic.

- Always uses `--output-format stream-json` when spawning `claude`.
- Accumulates stdout for result extraction.
- Calls `opts.onStdout?.(chunk)` for each raw stdout chunk — callers decide what to do with it.
- On close, calls `extractResult()` to parse the final result.

### Invokers (buildInvoker, reviewInvoker, planInvoker, spec)

Each invoker:
1. Calls `createDisplayCallbacks()` to get an `onStdout` handler and a `flush` function.
2. Passes `onStdout` to `invokeClaude()`.
3. After the invocation resolves, calls `flush()` to emit the trailing blank line.

The display logic is ~3 lines per invoker. This is the seam where a spinner or other UI would plug in.

## How blank line padding works

`createDisplayCallbacks` tracks a `hasStreamedText` flag:

- On the first `text` event: writes `\n` to stdout (leading blank line), sets flag.
- On each `text` event: writes the text to stdout.
- On `flush()`: if any text was streamed, writes `\n` to stdout (trailing blank line).

Since `console.log("[ridgeline] [phase] Building...")` already ends with a newline, the leading `\n` creates the visual gap. The trailing `\n` before the next `logPhase` call creates the gap after.

## NDJSON stream format

Claude CLI with `--output-format stream-json` emits one JSON object per line:

```jsonl
{"type":"assistant","subtype":"text","text":"Let me read the file..."}
{"type":"assistant","subtype":"text","text":"\nNow implementing..."}
{"type":"assistant","subtype":"tool_use","tool":"Read","args":{...}}
{"type":"result","result":"Done","total_cost_usd":0.05,"usage":{...},"session_id":"..."}
```

We only display `assistant` events with `subtype: "text"`. Tool use, system messages, and other events are silently skipped. The `result` event is parsed for cost/usage/session tracking but not displayed.

## Future work

### Spinner

Replace `createDisplayCallbacks()` with a spinner-aware version in each invoker. The spinner would:
- Show an animated indicator while waiting for text events.
- Pause on first text event, let text stream through, resume on silence.
- The stream parser and subprocess runner don't need to change.

Look at trellis-exec's `src/ui/spinner.ts` for a reference implementation with pause/resume coordination.

### Specialist agents

The builder already has `Agent` in its `allowedTools`, so it can dispatch Claude Code subagents. To enable domain-specific agents:

1. Users define agent `.md` files in `.ridgeline/agents/` (or per-build in `.ridgeline/builds/<name>/agents/`).
2. `buildInvoker` scans for these and injects a manifest into the user prompt describing what's available.
3. The builder's system prompt gets instructions on when to delegate vs. do the work itself.
4. The invoker and stream parser don't change — it's purely prompt content.

See trellis-exec's `agents/` directory and `src/orchestrator/agentLauncher.ts` for a working implementation of convention-based agent discovery and dispatch.

### Quiet mode

If someone pipes ridgeline output to a file or another process, they'll get interleaved harness and LLM text. A `--quiet` flag could suppress LLM streaming by simply not passing `onStdout` to `invokeClaude`. The invoker already handles `onStdout` being undefined (it just doesn't call it).
