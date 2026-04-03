---
name: Happy path design
description: Optimize for happy path while keeping interfaces flexible and composable
type: feedback
---

Prefer to optimize for the happy path while staying as flexible as possible — both in terms of user-computer interface and internal module relationships and composability. Don't assume future needs, but don't close doors either. Keep modules composable with full interfaces (e.g., keep pause/resume even if current usage only needs stop).

**Why:** User values clean defaults that "just work" for the common case, but wants the building blocks to remain flexible for different integration patterns.

**How to apply:** When designing interfaces, expose the full capability set (stop/pause/resume, not just stop). When integrating, use the simplest path that works (stop on first text), but don't strip flexibility from the underlying module.
