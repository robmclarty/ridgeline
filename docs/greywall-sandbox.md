# Greywall Sandbox

How Ridgeline runs the Claude CLI inside [Greywall](https://github.com/GreyhavenHQ/greywall),
what the sandbox actually allows, and why the integration is structured the
way it is.

For the broader threat model and the menu of community tools we surveyed,
see [sandboxing-and-access-control.md](./sandboxing-and-access-control.md).

---

## What it does

Every Claude subprocess Ridgeline spawns is wrapped in `greywall -- claude
<args>` when Greywall is detected on the host. Greywall is a deny-by-default
OS-level sandbox (Seatbelt on macOS, bwrap + Landlock + Seccomp + eBPF on
Linux) that gives us three things the Claude CLI does not provide on its
own:

1. **Filesystem isolation.** Writes outside the build's worktree (and a
   small set of cache/config paths) are blocked by the kernel, not by an
   LLM following instructions.
2. **Network allowlisting.** Outbound traffic is routed through `greyproxy`,
   a transparent proxy with a domain-pattern allow/deny list. Anything not
   on the list is dropped before it leaves the box.
3. **Credential isolation.** Real registry tokens, SSH keys, and cloud
   credentials live outside what the agent can read.

Layered on top of Ridgeline's git-worktree-per-build model, this means a
runaway or compromised agent cannot exfiltrate code, install malicious
binaries to global locations, or modify files outside its worktree.

---

## How profiles compose

Greywall's permission model is built from two kinds of named profile,
both registered upstream in `internal/profiles/`:

- **Agent profiles** (`claude`, `codex`, `cursor`, `aider`, …) — what an
  AI coding tool itself needs: its config dir, its OAuth state, its API
  endpoints. The `claude` profile, for example, allows reads/writes under
  `~/.claude` and `~/.claude.json`, and allows network egress to
  `api.anthropic.com`, `mcp-proxy.anthropic.com`, `github.com`,
  `registry.npmjs.org`, and a handful of others.
- **Toolchain profiles** (`node`, `python`, `go`, `rust`, `ruby`, `java`,
  `containers`, `iac`, `scm`) — what a *language ecosystem* needs to
  install packages and run binaries. The `node` profile (registered for
  the names `node|npm|npx|yarn|pnpm|bun|deno`) covers `~/.npm`, `~/.npmrc`,
  `~/.pnpm-store`, `~/.config/pnpm`, `~/.local/share/pnpm`,
  `~/.local/state/pnpm`, `~/.yarn`, `~/.cache/turbo`, `~/.cache/prisma`,
  `~/.node-gyp`, `~/.volta`, `~/.bun`, `~/.deno`, plus
  `~/Library/Caches/ms-playwright` and `~/Library/Caches/Cypress` on macOS.

Profiles are selected with `--profile name1,name2`. Greywall merges them
by appending and deduplicating the slice fields (allow/deny path lists,
network rules) and OR-ing the booleans.

Ridgeline always passes both:

```sh
greywall \
  --profile claude,node \
  --no-credential-protection \
  --settings /tmp/ridgeline-greywall-<pid>.json \
  -- claude <args>
```

Defined in `src/engine/claude/sandbox.greywall.ts`. Other toolchains can
be added by appending to `GREYWALL_PROFILES` (e.g. `"claude,node,python"`
for a build that touches a Python sidecar).

### Why explicit `--profile`, not `--auto-profile`

Greywall has an `--auto-profile` flag that detects the agent from the
command name. It looks at `claude` in `greywall -- claude …` and applies
the `claude` agent profile.

But auto-detection does **not** apply toolchain profiles. The command is
`claude`, not `npm`, so the `node` profile never fires under
`--auto-profile`. Before this was understood, Ridgeline papered over the
gap with a hand-rolled `packageManagerCachePaths()` list and an
`NPM_CONFIG_USERCONFIG=/dev/null` environment override (because the
auto-profile's credential-dotfile deny rule was blocking pnpm's `.npmrc`
read). Both have been removed: explicit `--profile claude,node` covers a
strict superset of what we hand-rolled, allows `~/.npmrc` reads
natively, and stays in sync with greywall upstream as toolchains evolve.

`--profile` and `--auto-profile` are mutually exclusive in greywall —
explicit names bypass the auto-detection branch entirely.

---

## How `--settings` layers on top

Per-build paths that aren't part of any toolchain profile — chiefly the
build's worktree and any caller-supplied scratch directories — go in a
generated settings file:

```json
{
  "filesystem": {
    "allowWrite": ["/repo/.ridgeline/worktrees/build-foo", "/tmp"]
  }
}
```

Greywall loads `--settings` first, then merges profile rules on top using
the same append-and-deduplicate logic. The result: per-build dynamic
paths and toolchain static paths coexist; neither has to know about the
other.

`buildArgs` accepts an `additionalWritePaths` parameter for callers that
need to expose extra directories (e.g. a shared `node_modules` symlink
target outside the worktree).

---

## Network rules via `greyproxy`

Domain rules don't go in the settings file — they are pushed to the
`greyproxy` daemon's REST API at `http://localhost:43080/api/rules`
before each spawn. `syncRules()` fetches the current ruleset, diffs
against the requested allowlist, and POSTs only the missing entries.
Rules are scoped to the `claude*` container pattern so they apply only
to Ridgeline-spawned processes, not to other things you might run under
greywall on the same machine.

The default allowlist (npm, PyPI, crates.io, GitHub, …) lives in
`src/stores/settings.ts` and is overridable via
`.ridgeline/settings.json`'s `researchAllowlist` array. User entries
**replace** the defaults rather than extending them — explicit choice,
not accident.

---

## `--no-credential-protection`

Greywall has a feature that substitutes fake placeholder values for
known credential variables (registry tokens, AWS keys) before the
sandboxed process sees them. Ridgeline disables this with
`--no-credential-protection` because the substitution interferes with
real installs (pnpm needs a working `.npmrc`, `gh` needs a real
`GITHUB_TOKEN`, etc.).

The trade-off is conscious: filesystem and network walls are the hard
boundaries; credential protection would be an extra belt-and-braces
layer that breaks too many normal workflows to be worth it here. For
projects with stricter secrecy requirements, drop the flag and supply
substitutes via greywall's keyring lookup config.

---

## When something gets blocked

If a build fails because greywall denied a read or write, the failure
will surface as a non-zero exit from the underlying tool (often `pnpm
install` exiting 254, or a postinstall script failing to write a binary).
Three places to look:

1. **Inside the worktree?** Worktree paths are always in `allowWrite`.
   If a write inside the worktree is being denied, the worktree path
   isn't being passed to `buildArgs` correctly — a Ridgeline bug, not a
   greywall config issue.
2. **A standard toolchain cache?** Check the `node` profile (linked
   above) — if the path *should* be covered but isn't, file an issue
   upstream rather than working around it locally. The toolchain profile
   is the right place to fix it for everyone.
3. **An unusual global path** like `~/.local/bin` or a tool-specific
   directory not in any profile? Add it to `additionalWritePaths` at the
   call site. Don't extend the toolchain list in
   `sandbox.greywall.ts` — that file deliberately delegates the
   "what does node need?" question to greywall.

For network denials, check `greyproxy`'s dashboard (or its log) for the
rejected domain, then add it to `researchAllowlist` if it belongs there.

---

## Why this matters

The two pieces of code Ridgeline owns here are small — one provider
(`sandbox.greywall.ts`) and one detector (`sandbox.ts`) — but they are
load-bearing. They turn "the agent should not write outside the
worktree" from a prompt instruction (which any sufficiently confused
model can violate) into a kernel-enforced invariant. They turn "the
agent should not call arbitrary URLs" from a behavioral guideline into a
proxy that drops the packet.

Structural enforcement is more reliable than behavioral restriction. The
fellowship project measured roughly 33% prompt-only compliance versus
95%+ when the same restriction was enforced structurally. OS-level
sandboxing is the structural version of "stay in your lane" for code-
writing agents — and the cost of getting it wrong is the difference
between a build that fails loudly and a build that quietly does
something off-spec on the host filesystem.
