# Host-side phase routing

Backlog item from the fascicle-migration Phase 10 incident (2026-05-07): the
build harness ran Phase 10 inside greywall seven times in a row. Every
continuation reported the same blocker — Stryker's parent↔worker IPC uses
`net.createConnection(port, 'localhost')`, which Seatbelt denies with EPERM —
and the harness had no mechanism to route the phase outside the sandbox. The
operator eventually ran the documented host-side recipe by hand to capture
both mutation scores.

This doc plans the third option from the incident triage: let phases declare
they need to run on the host outside greywall, and let ridgeline honour that
declaration automatically.

## Why this matters

Greywall blocks more than network egress — its Seatbelt profile also denies
TCP loopback connect, which any tool with a TCP-IPC parent/worker model trips
over. Stryker is the canonical example, but the same shape applies to several
common toolchains:

- Mutation testing (Stryker, plus most Stryker plugins).
- Benchmarking harnesses that use a separate logging/metrics process.
- Some test runners with a daemon model (`jest --watch`, `bun test --watch`).
- Anything built on `node-ipc` or `socket.io` with the TCP transport.

Today the only escape hatch is "operator runs it manually". That breaks the
build-loop abstraction: the harness can't make forward progress, the phase
spins on retries, and the human-in-the-loop path is undocumented per phase.

## Goal

Let a phase author declare `requires_host: true` (or similar) in phase
frontmatter. When the harness schedules that phase, instead of running the
builder inside greywall, it routes the work through a host-side execution
channel. The output (artifacts, exit code, logs) flows back into the build
loop the same way an in-sandbox phase's output does.

A small set of phases — Phase 10 of the fascicle-migration build, possibly
future security-scan or hardware-touching phases — opts in. Everything else
stays sandboxed.

## Constraints

- **Don't widen greywall.** This proposal is *not* about adding loopback or
  port exceptions to greywall. The threat model that motivated greywall in
  the first place still holds for normal phases.
- **Preserve the build-loop contract.** Host-side phases must produce the
  same artifacts (`<phase-id>.builder-progress.md`, check files, score files)
  in the same locations, so reviewers and downstream phases see the work
  identically.
- **Operator must consent.** A host-side phase runs outside the sandbox, so
  the harness should refuse to schedule one unless the operator has
  explicitly opted in for this build (e.g. `--allow-host-phases` flag or a
  per-build settings entry). Default behaviour is "fail loudly with a clear
  message", not "silently run on the host".
- **One mode at a time per build.** Don't try to mix in-sandbox and
  host-side phases inside the same wave; serialize host-side phases.

## Approach

### Phase frontmatter

Add an optional field to phase markdown frontmatter:

```yaml
---
id: 10-mutation-tests
depends_on: [09-build-auto-sigint-dogfood]
requires_host: true
host_reason: "Stryker IPC uses TCP-localhost (denied by greywall Seatbelt profile)"
---
```

`requires_host: true` is the trigger. `host_reason` is mandatory when the
flag is set; it documents *why* this phase needs host access (so future
readers can re-evaluate when greywall or the tool changes).

### Scheduler

In `src/commands/build.ts` (`executeWaveLoop`), before invoking the builder
for a phase:

1. If `phase.requires_host !== true`, run as today (in-sandbox via
   `runAndTrackPhase` / `runParallelWave`).
2. If `phase.requires_host === true`:
   - Verify `--allow-host-phases` (or the equivalent settings flag) is set.
     Otherwise, mark the phase failed with a clear "host phase blocked,
     re-run with --allow-host-phases" message.
   - Force-serialize: don't include this phase in any wave with other
     phases. Run it alone.
   - Invoke the builder via the host-side channel (see below).
   - On builder return, treat the result the same as an in-sandbox phase:
     read the progress file, run the reviewer, etc.

### Host-side execution channel

Two implementation paths, in increasing order of effort:

1. **External hand-off file.** The harness writes the builder prompt + tool
   list to `.ridgeline/builds/<build>/host-queue/<phase-id>.json`, sets the
   phase status to `awaiting_host`, and prints a clear instruction to the
   operator: "Run `ridgeline host run <build> <phase-id>` from a shell
   *outside* greywall". The harness then polls or blocks on a sentinel file
   the host-side runner produces. This requires no new privilege model — the
   operator is the trust anchor.

2. **Detached child outside greywall.** The harness shells out via a known
   "escape hatch" mechanism (e.g. `osascript -e 'tell app "Terminal" to do
   script ...'` on macOS, or a user-installed launcher daemon listening on a
   Unix socket). This is fully automated but requires the operator to set up
   the launcher once. The launcher itself runs *outside* greywall and spawns
   the builder there; the harness inside greywall communicates with it over
   a pre-forwarded port (`greywall -f`).

Path 1 is pragmatic and matches what the operator did manually for Phase 10.
Path 2 is the better long-term answer but adds a new component to install.

### Reviewer + verifier

Reviewers and verifiers should still run **inside** greywall — they're
read-only and don't need host access. The asymmetry is intentional: only the
specific tool that requires loopback IPC runs outside the sandbox; everything
that *checks* its output runs sandboxed.

### Resumeability

If the operator interrupts a host-side phase mid-run (Ctrl-C, machine
reboot), the next `ridgeline build resume` should detect the dangling
`awaiting_host` status and either re-queue the phase or report the partial
state clearly. Today the harness already has resume logic for in-sandbox
phases via checkpoint tags; host-side phases need an equivalent state
("host phase started but not committed") to avoid losing work.

## Concrete sequence (path 1 — hand-off file)

For the next build that hits a Stryker phase:

```sh
ridgeline build my-build --allow-host-phases
# ... harness runs phases 1..N in sandbox, hits phase N+1 with requires_host:true
# Harness writes .ridgeline/builds/my-build/host-queue/N+1.json and pauses
# Harness prints:
#   "Phase N+1 requires host execution. Run in another terminal:
#      ridgeline host run my-build N+1
#    The build loop will resume automatically when the host run commits."

# In a separate terminal, OUTSIDE greywall:
ridgeline host run my-build N+1
# ... runs Stryker (or whatever the host-side work is), captures artifacts,
#     commits them on the build branch, drops a sentinel file the harness sees.
```

The harness wakes up on the sentinel, runs the reviewer in-sandbox, and
proceeds.

## Migration / backwards compatibility

- Existing phases without `requires_host` keep working unchanged.
- The fascicle-migration build's Phase 10 frontmatter would gain
  `requires_host: true` retroactively, so future re-runs of this build
  Don't trip the same blocker.
- A new build catalog entry "host-phase smoke test" should exercise the
  scheduler path end-to-end so future regressions are caught by
  `npm run check`.

## Open questions

- Does ridgeline already have a "human-in-the-loop" pause primitive
  elsewhere (e.g. plan-review approval gates)? If so, host-side phases
  should reuse that wait/wake mechanism rather than inventing a sentinel
  file format.
- Should `requires_host` be inferred automatically (greywall returns EPERM
  → harness retries on host) instead of declared? Inference is more robust
  but harder to reason about; declaration is explicit but easy to forget.
  Recommend starting with declaration and adding inference only if the
  manual list grows large.
- How does this interact with the parallel-wave scheduler proposal in
  `parallel-wave-fixes.md`? At minimum, host-side phases force
  `--max-parallel 1` for that wave.

## Order of operations

1. Extend `parsePhaseFrontmatter` in `src/stores/phases.ts` to also pull
   `requires_host` (boolean) and `host_reason` (string) out of the
   frontmatter block. The current parser is two regexes; the simplest
   evolution is to pick up a YAML parser (no `gray-matter` / `yaml`
   dep is in package.json today) or extend the regex pattern to cover
   `requires_host: true` and `host_reason: "..."`. Thread the fields
   through the phase record returned to the harness. No behaviour
   change yet.
2. Add `--allow-host-phases` CLI flag and gate the scheduler on it.
3. Implement path 1 (hand-off file): the harness writes the queue file,
   prints instructions, and polls; add a `ridgeline host run` subcommand
   that consumes the queue file.
4. Annotate Phase 10 of the fascicle-migration spec template with
   `requires_host: true` so a hypothetical future re-run of this build
   would route it correctly.
5. (Later) Path 2 (launcher daemon) if the manual hand-off proves too
   friction-heavy in practice.

Steps 1–4 are the minimum viable host-phase routing. Step 5 is the
fully-automated upgrade.

## Cross-references

- Incident: `.ridgeline/builds/fascicle-migration/phase-10-stryker-environment.md`
- Discoveries: `.ridgeline/builds/fascicle-migration/discoveries.jsonl`
  (entries dated 2026-05-07T06:30 and 07:00 for the Stryker IPC blocker).
- Related backlog: `docs/parallel-wave-fixes.md` (CLI flags + scheduler
  hooks; host-phase routing should land near these changes).
- Greywall sandbox model: `docs/greywall-sandbox.md`.
