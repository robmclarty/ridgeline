# Backlog

Tracked follow-ups, deferred work, and known capability gaps. Items here are
intentional — when you choose to defer a thing, write it down.

For incident-driven follow-ups scoped to one area, prefer a topic doc under
`docs/` (e.g. `docs/parallel-wave-fixes.md`) and link it from here.

## Open

### Finish Anthropic direct-API integration: skills, tools, sandbox

The `anthropic` provider was wired into `engine.factory.ts` so
`--model sonnet` and `--model anthropic:claude-haiku-4-5` route through the
direct API. Today only `model_call` works through that path. Reaching
feature parity with the `claude_cli` route requires:

- **Tools.** Wire ridgeline's tool definitions (file read/write, shell
  execution, etc.) through fascicle's `Tool` interface so they're callable
  via the API path. Today they're invoked by the CLI subprocess; the API
  call returns plain content with no tool execution loop.
- **Skills / agent discovery.** `src/engine/discovery/*` reads
  `agents/*` markdown into a registry that the CLI provider mounts. The
  API path doesn't surface this; agents aren't discoverable when calling
  via API.
- **Greywall sandbox.** `claude_cli` enforces `sandbox: { kind: 'greywall' }`
  at the subprocess boundary. The API route runs in-process, so file
  writes and network calls happen without sandboxing. Either reuse the policy as
  a wrapper around `Tool` execution, or document that API mode is
  trusted-input only.
- **Cost / trajectory parity.** Verify the `anthropic` provider emits the
  same trajectory event shape (cost, usage, stream chunks) so
  `cost_capped`, the budget subscriber, and `fascicle-viewer` work
  uniformly across providers.
- **Selection guidance.** Update `docs/help.md` and the model-selection
  surface to make the capability difference between `cli-*` (full kit)
  and bare/`anthropic:` (model_call only) explicit.

Until this lands, treat the API route as suitable for cheap one-shot
calls (e.g. classifiers, judges) but not for builder/reviewer/specialist
work that depends on tools and agents.

Tracking ref: `docs/fascicle-migration-outcome.md` § Multi-model support.
