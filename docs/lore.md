# The Ridgeline

## The Sweetspot

A ridgeline is the highest continuous line of a mountain range — the narrow
path that runs along the crest where both sides fall away. It is neither one
slope nor the other. It is the threshold between them.

Stand on a ridgeline and you can see both valleys at once. Step too far in
either direction and you lose sight of the other side entirely. The ridgeline
is the only place where both perspectives are visible, where the full
landscape can be held in view.

Software lives in this same tension. On one side: ideas, specifications,
intentions — what the thing *should be*. On the other: code, execution,
implementation — what the thing *actually is*. Most projects fall off the
ridge early. They either stay in the realm of planning (specs that never ship)
or dive straight into code (implementations that drift from intent). The gap
between the two grows silently until someone notices that what was built
doesn't match what was meant.

Ridgeline walks the crest. A spec describes what should exist. A planner
decomposes it into phases. A builder implements each phase. A reviewer
verifies the work against the original criteria — not against opinion or
style, but against the spec itself. Then the next phase begins. At every
step, both sides of the mountain remain visible: the intent and the
implementation, checked against each other, kept in balance.

## The Spine

There is a second meaning to the word. A ridgeline is also the spine of the
mountain — the structural backbone that gives the entire formation its shape.
Without it, there is no mountain. There are only loose slopes collapsing into
each other, indistinguishable terrain with no clear path through.

Large software projects suffer this same collapse. Without structure, work
bleeds together. Tasks depend on tasks that depend on tasks, context is lost
between handoffs, and no single contributor can hold the full picture. The
project becomes a landscape without orientation — you can move, but you
cannot navigate.

Ridgeline provides the spine. Phases are ordered and numbered. Each one is
self-contained: a goal, context from what came before, and acceptance
criteria that define when the work is done. The handoff from one phase
carries forward only what the next phase needs to know. State is tracked.
Progress is checkpointed. If the process stops, it can resume from where it
left off, because the spine is intact.

This is what structure does. It doesn't constrain — it *orients*. A ridgeline
doesn't tell you how to climb the mountain. It tells you where the mountain
is.

## The Traverse

Mountaineers speak of "traversing a ridge" — moving along its length rather
than ascending or descending. A ridge traverse is one of the most demanding
types of route. It requires sustained attention because the exposure is
constant: every step matters, and the consequences of losing balance are
immediate.

Building software across many phases has this same character. Each phase is a
step along the ridge. The planner sets the route. The builder takes each
step. The reviewer checks the footing before moving on. If a step fails —
if the check command does not pass, if acceptance criteria are not met — the
route does not advance. The builder tries again with specific feedback about
where the footing was wrong.

This is not iteration for its own sake. It is the discipline of not moving
forward until the ground beneath you is solid. Software that advances without
verification is a climber who doesn't check their anchors. It may work. It
often doesn't.

## The Watershed

A ridgeline is a continental divide. Rain that falls on one side flows to one
ocean; rain that falls on the other flows to another. The ridge itself is the
decision boundary — the line where outcomes diverge.

In Ridgeline, the spec is this divide. Everything upstream of the spec is
intention: what problem is being solved, what constraints exist, what success
looks like. Everything downstream is execution: phases, builds, reviews,
commits. The spec is the point where intention becomes commitment. Once the
planner reads the spec and produces phases, the water is flowing downhill.

This is why the spec matters so much. A vague spec produces vague phases
which produce vague implementations which produce vague failures. A precise
spec produces precise phases with testable criteria and reviewers who can
give concrete verdicts. The quality of everything downstream is determined
at the watershed.

## The Treeline

Above a certain altitude, trees stop growing. The treeline marks the
boundary where conditions become too harsh for complex, rooted life. Above
it, only what is essential survives: rock, ice, low scrub that hugs the
ground.

Context windows have their own treeline. Below it, a builder can hold an
entire codebase in mind — every file, every dependency, every interaction.
Above it, complexity exceeds what can be reasoned about at once. Details are
lost. Connections are missed. Mistakes compound.

Ridgeline's phase system is designed for life above the treeline. Each phase
is sized to fit within the builder's effective context — roughly half its
window, leaving room for the codebase exploration that implementation
requires. The planner does the work of decomposition so that each builder
operates in conditions where it can survive: enough context to do the work,
not so much that it loses its footing.

This is not a limitation. It is an adaptation. The mountain does not become
shorter because you cannot see all of it at once. You simply need a way to
traverse it in stages, and the ridgeline is that way.

## The View From the Top

There is a reason people climb to ridgelines. The view.

From the ridge you can see where you have been and where you are going. You
can see the shape of the terrain, the obstacles ahead, the progress behind.
You have perspective that is impossible from the valley floor.

Ridgeline's trajectory log, state tracking, and budget accounting serve this
purpose. At any point in a build, you can see what phases have completed,
what failed and why, what the reviewer said, how much has been spent, and
what remains. You are not lost in the work. You are above it, with a clear
view of the whole route.

This is the promise of the ridgeline: not that the climb is easy, but that
the path is clear.
