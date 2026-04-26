---
name: spec-to-ridgeline
description: Convert an arbitrary spec, PRD, RFC, or design doc into a ridgeline-ready trio of `spec.md` + `constraints.md` + `taste.md` (and optional `design.md`) saved to a target directory. Use this skill whenever the user wants to feed a single freeform specification into ridgeline, asks to "ridgeline-ify" or "split" a spec, mentions converting a PRD/RFC/design doc into ridgeline inputs, or requests producing constraints/taste/spec files from one source document. Do NOT trigger for editing an existing constraints.md/taste.md/spec.md — only for the initial extraction from a single source spec.
---

# Spec → Ridgeline Converter

Take **one** arbitrary specification (PRD, RFC, design doc, technical spec, freeform notes) and split it into the file trio ridgeline expects:

- `spec.md` — **what** to build (outcomes, behaviors, interfaces, success criteria)
- `constraints.md` — **non-negotiable** technical guardrails + a check command
- `taste.md` — **best-effort** style preferences and design philosophy
- `design.md` *(optional)* — visual design tokens; only emit when the project has a visual surface (web UI, game, mobile, print)

The source spec is left untouched. The four files are written into a target directory the user names.

## Inputs the user must supply (or you must ask for)

1. **Source spec path** — the single file to convert (markdown, plaintext, etc.)
2. **Target directory** — where to write `spec.md` / `constraints.md` / `taste.md` (e.g. `./mk1-ai/`)
3. **Project context** *(infer from source; only ask if missing)* — language/runtime, framework, package name, existing codebase to align with
4. **Design.md needed?** — default no. Only yes if the source describes a visual surface

If any of (1) or (2) is missing, ask once, then proceed.

## Reference example

A worked example lives at `/Users/robmclarty/Projects/agent-kit/docs/mk1-comp/` (produced from `agent-kit-composition-layer-spec.md`). When in doubt about tone, depth, or section ordering, **read those three files** before writing new ones — they are the canonical shape.

The ridgeline format itself is defined in:

- `~/projects/ridgeline/code/ridgeline/docs/spec-driven-development.md`
- `~/projects/ridgeline/code/ridgeline/docs/constraints-and-taste.md`
- `~/projects/ridgeline/code/ridgeline/docs/design.md` (if `design.md` is being produced)

Pull these only if you need a refresher; the rules below capture the load-bearing parts.

## The split (decision rules)

Use this three-question test on every paragraph of the source spec:

1. **Would violating this fail the build, regardless of outcome?** → `constraints.md`
2. **Does this describe a behavior, interface, or outcome the system must produce?** → `spec.md`
3. **Is this a preference about shape/style that a builder could reasonably deviate from with justification?** → `taste.md`

Material that is pure rationale ("why we chose X") goes to `taste.md` if it justifies a stylistic decision, or stays in `spec.md` as a brief inline note if it justifies an interface choice. Don't lose the *why*; ridgeline agents make better calls with it.

### What goes in `constraints.md`

Hard, mechanically-checkable rules. Examples:

- language + runtime + module format ("TypeScript 5.x strict, ESM only, Node ≥ 20")
- framework / SDK pinning
- directory structure (where files MUST live)
- forbidden constructs (no `class`, no global state, no `process.env` outside file X)
- dependency policy (allowed/forbidden packages, peer vs runtime)
- architectural invariants (layer A may not import from layer B)
- naming conventions (snake_case files, PascalCase types)
- the **check command** — the literal shell command CI runs to verify a phase passes (e.g. `npm test && npm run typecheck && npm run lint`). Always include this. If the source doesn't specify one, infer the most plausible one from the constraints and mark it `# inferred — adjust if wrong`.
- v1 scope fence (in scope / explicitly out of scope / deferred-with-bar-for-promotion)
- distribution & versioning rules
- testing requirements (runner, coverage gates, mocking boundary)

### What goes in `spec.md`

Outcomes and contracts. Examples:

- problem statement (why this exists)
- solution overview / data flow / layer position
- interface definitions (function signatures, types, options objects, result shapes)
- semantics & runtime contract (what each operation does, in what order, with what guarantees)
- failure modes (each named, with scenario / behavior / test)
- success criteria (the testable list — every item phrased as "X happens when Y")
- file structure (the actual files to create, with one-line purpose each)
- environment variables read
- open questions (deferred decisions with current leaning)

`spec.md` may *reference* constraints (`See constraints.md §3`) but should not duplicate them.

### What goes in `taste.md`

Why the API is shaped the way it is, and what "good code" looks like at a call site. Examples:

- design principles (numbered, each with **Rule** + **Why**)
- "what this rules out" — explicit anti-patterns and the reasoning
- "what good code looks like" — one or two short call-site examples
- carry-over decisions inherited from sibling layers/projects

Taste is opinionated and prose-heavy. Reviewers do not enforce it. Builders follow it unless they have a concrete reason not to.

### What goes in `design.md` (only if needed)

Visual tokens and conventions: color palette, typography, spacing scale, component patterns, accessibility level, motion preferences. Skip entirely for backend / CLI / library work.

## Process

1. **Read** the source spec end-to-end.
2. **Read** the reference example at `mk1-comp/` (all three files) if you have not in this conversation.
3. **Inventory** the source: list every distinct claim, rule, interface, principle, failure mode, and rationale. Tag each with `C` (constraint), `S` (spec), `T` (taste), or `D` (design).
4. **Draft `constraints.md` first.** It is the smallest and the most rigid; getting it right anchors the others. Always include `## Check Command` near the top.
5. **Draft `spec.md` next.** Lead with the problem statement, then solution overview, then interfaces, then runtime contract, then failure modes, then success criteria, then file structure. Use `§N` numbering for major sections (matches ridgeline house style and the mk1-comp example).
6. **Draft `taste.md` last.** Numbered design principles, each with **Rule** + **Why**. Close with "what this rules out" and "what good code looks like".
7. *(Optional)* Draft `design.md` only if the source has visual scope.
8. **Cross-check**: read the three drafts together. No content should appear in two files. Every load-bearing fact from the source should appear in exactly one.
9. **Write** to the target directory. Do not modify the source.
10. **Report**: a short summary listing each output file, its line count, and any items from the source you intentionally dropped (with one-line reasons).

## House-style notes (from the reference example)

- Use H1 for the document title ("`# <Layer Name> — Specification`"), H2 for `## §N — <Section>`, H3 for sub-sections.
- Each document opens with: `**Status:**`, `**Sibling documents:**` (cross-references to the other two/three files), `**Scope:**`.
- Tables work well for: dependency lists, alias tables, env vars, trajectory events, "what / why" decision guides.
- Code fences are TypeScript-tagged when showing real interfaces.
- For failure modes, use the consistent triplet: **Scenario** / **Behavior** / **Test** (and optionally **Rationale**).
- For success criteria, write each item as a single testable assertion ("Basic text generation returns ...").
- Keep `taste.md` prose-first. Keep `constraints.md` bullet-first. Keep `spec.md` interface-first with prose surrounding each block.

## Anti-patterns to avoid

- **Don't paraphrase the source into vagueness.** If the source says "max 10 steps", the spec says "max 10 steps", not "a reasonable cap".
- **Don't invent constraints the source doesn't justify.** If the user didn't specify a check command, mark the inferred one as `# inferred`.
- **Don't blur the boundary between files.** If you find yourself writing the same fact twice, decide which file owns it and link from the other.
- **Don't add `design.md` for non-visual projects.** A backend library has no business having one.
- **Don't drop the rationale.** Future agents (and the user) lose calibration without it. If a rule has a non-obvious *why*, keep the *why* in the same file as the rule.
