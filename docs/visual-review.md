# Visual Review

For phases that touch visual code, the reviewer dispatches the
**visual-reviewer** specialist to score rendered output against the
project's design system and any visual anchors. This page covers when
visual review fires, the five scoring dimensions, the pass/fail
thresholds the reviewer composes from its critique, and how to ensure
visual phases get reviewed well.

## When Visual Review Fires

The reviewer dispatches the visual-reviewer specialist when **both** are
true for the current phase:

1. The git diff touches visual code: `apps/**/*.tsx`, `*.svg`, `*.css`,
   `tailwind.config.*`, or other rendered surfaces.
2. The sensor findings include screenshot paths captured by the playwright
   sensor for this phase.

When neither condition holds, visual review is skipped silently.

## Required Views

Visual phases should declare a `## Required Views` section in the phase
spec that lists the screenshots the visual-reviewer needs:

```markdown
## Required Views

- canvas-default: 1280x800, url /
- node-zoomed-in: 1280x800, zoom 2.0, url /flow/hello
- mid-flow: 1280x800, url /flow/hello?demo=mid-flow
```

Each item is `<label>: <attr>, <attr>, ...` where attributes may be:

- `<width>x<height>` — viewport size (e.g., `1280x800`).
- `zoom <n>` — CSS zoom factor applied to `document.body` before capture.
- `url <path-or-absolute>` — overrides the dev-server root path.

When `Required Views` is declared, the harness loops the playwright sensor
over each view and persists per-view PNGs under
`<buildDir>/sensors/<phaseId>/`. The visual-reviewer reads each one and
grounds its Fix items in concrete `<screenshot>:<file>:<line>` evidence.

When the section is absent, the harness captures a single default
screenshot (back-compat). The visual-reviewer notes lower confidence in
its `confidence_caveats`. The plan-reviewer flags visual phases that omit
this section during plan synthesis — the back-compat path exists, but
explicit views produce stronger reviews.

## The Five Dimensions

Visual-reviewer scores each dimension 0-10. Lower is worse. Each score
must cite one piece of evidence — a screenshot file plus a project
file/line where applicable.

| Dimension | What it scores |
|-----------|----------------|
| **taste_fidelity** | Does the output match design.md's hard tokens and reference anchors? Hex codes correct? Component shapes match? Typography respected? |
| **motion_discipline** | Do animations match design.md's motion rules? Anything animating that shouldn't? Strobe rates? Idle elements pulsing? |
| **information_hierarchy** | Readable at every zoom level the spec requires? Loading/empty/error states handled? Text contrast meets the accessibility floor? |
| **convention_adherence** | Frontend code conventions from constraints.md respected (snake_case events, named exports, no inline styles, etc.)? |
| **anti_slop** | Generic AI-default patterns present? Hard-no list (purple gradients, left-border-accent cards, marketing-AI-sparkle iconography, glassmorphism without justification, etc.). |

Hard-no patterns under `anti_slop` are a baseline; projects can extend the
list via a `taste.md` `Banned patterns` section.

## Output Format

The specialist returns a single JSON block:

```json
{
  "scores": {
    "taste_fidelity": 7,
    "motion_discipline": 9,
    "information_hierarchy": 6,
    "convention_adherence": 10,
    "anti_slop": 8
  },
  "evidence": {
    "taste_fidelity": "Sepia palette correct, but node corner radius is 12px (rounded-rectangle territory). screenshot-default.png, apps/studio/src/nodes/step_node.tsx:42",
    "motion_discipline": "No motion visible in captured views; scoring full marks by absence.",
    "information_hierarchy": "Empty state missing. screenshot-zoomed-in.png shows blank canvas when no flow loaded.",
    "convention_adherence": "All frontend conventions respected per constraints.md.",
    "anti_slop": "No baseline anti-slop patterns present."
  },
  "keep": [
    "Wax-seal run badge in top-right history strip — exact right weight"
  ],
  "fix": [
    {
      "location": "apps/studio/src/nodes/step_node.tsx:42",
      "issue": "Node corner radius 12px (rounded-rectangle).",
      "correction": "2-3px stamped-rectangle radius with corner rivets per design.md."
    }
  ],
  "quick_wins": [
    "Reduce parchment background saturation by ~10% — currently competes with sepia text."
  ],
  "confidence_caveats": []
}
```

- **`fix`** items must have `location`, `issue`, and `correction`. The
  correction describes outcome, not implementation.
- **`quick_wins`** are visual refinements within the locked design — not
  new scope, not Fix-level severity.
- **`confidence_caveats`** are appended automatically when reference
  anchors are missing or only one view was captured.

## Pass/Fail Thresholds

The reviewer composes the visual-reviewer's critique into the phase
verdict using these thresholds:

| Condition | Effect |
|-----------|--------|
| Any single dimension scored ≤ 3 | **Phase fails.** Add a blocking issue describing the dimension and citing the visual-reviewer's evidence. |
| `fix` list has 4+ items | **Phase fails.** Surface each Fix item as a blocking issue. |
| `fix` list has 2-3 items | **Fails on first attempt; may pass on retry** if addressed. Surface Fix items as blocking issues. |
| `fix` list has 0-1 items | **No impact on pass/fail.** Surface Quick Wins as `severity: "suggestion"`. |

A failing visual review is a phase failure even if every acceptance
criterion passes. The builder gets the visual-reviewer's Fix list as
feedback and addresses it on retry.

### Tuning thresholds

Projects can override the defaults via two `taste.md` keys:

- `min_dimension_score` (default `4`) — any dimension scored below this
  fails the phase.
- `max_fix_items` (default `1`) — beyond this many Fix items, retry is
  required.

The reviewer reads these once per review and applies overrides if
present.

## Calibration Anti-Patterns

Visual-reviewer's question is always **"Does this match the design system
and avoid AI defaults?"** — not "Is this how I would have designed it?"

The agent is calibrated against three failure modes:

- **Score inflation under uncertainty.** If every dimension lands at 8-9
  across multiple phases, visual-reviewer is rubber-stamping. The agent
  is instructed to record uncertainty in `confidence_caveats` rather than
  rounding up.
- **Score deflation out of style preference.** Score 0-3 is reserved for
  taste violations the design.md or anchors specifically prohibit, not
  for "I don't love this."
- **Design-system blame.** If every dimension lands at 3-4 across multiple
  phases, design.md is probably the problem rather than the builder.
  Visual-reviewer surfaces this in `confidence_caveats` rather than
  failing per-phase.

## What Visual-Reviewer Does Not Check

Visual-reviewer is a critique agent, not a stylist. It does not:

- Modify project files. It is `Read`, `Glob`, `Grep` only — no `Write`,
  no `Edit`, no `Bash`.
- Suggest feature work. Quick Wins are visual refinements within the
  locked design, never new scope.
- Add scoring axes. Five dimensions only. If a concern doesn't fit one
  of the five, it's a spec change, not a critique concern.
- Enforce taste.md conventions broadly. That's the auditor specialist's
  job. Visual-reviewer covers *frontend-specific* conventions the
  auditor doesn't know about.

## Without Reference Anchors

When `<buildDir>/references/` doesn't exist, visual-reviewer scores
without per-reference anchor descriptions. It still scores all five
dimensions, but `taste_fidelity` has higher variance because the only
anchor is `design.md` itself. The agent appends
`"scoring without reference anchors — taste fidelity score has higher variance"`
to `confidence_caveats` so this is visible in the verdict.

To improve the signal, run `ridgeline design` and name reference works
when the designer asks. The reference-finder will pull canonical imagery
into `<buildDir>/references/<slug>/` and write `visual-anchors.md`. See
[References and Anchors](references-and-anchors.md).

## Debugging a Visual Failure

When a phase fails on visual review:

1. Read `<phase>.feedback.md` — the harness composes the visual-reviewer's
   Fix list into the feedback file alongside any other reviewer issues.
2. Open the screenshots under `<buildDir>/sensors/<phaseId>/`. Each Fix
   item cites a screenshot path; load it to see exactly what failed.
3. If the Fix correction is unclear, re-read `design.md`. The
   visual-reviewer scores against hard tokens; if the tokens are
   ambiguous, every retry will struggle.
4. If multiple dimensions are scoring 3-4 across phases, the problem is
   probably `design.md` or the picked direction, not the builder. Run
   `ridgeline rewind <name> --to design` and tighten the design system
   before retrying.

## Related Docs

- [Design](design.md) — how `design.md` (the visual-reviewer's primary
  input) is established.
- [References and Anchors](references-and-anchors.md) — how reference
  imagery is sourced and written into `visual-anchors.md`.
- [Review and Feedback](review-and-feedback.md) — the broader review loop
  that visual review composes into.
- [Directions](directions.md) — how a picked direction shapes
  `design.md` upstream of visual review.
