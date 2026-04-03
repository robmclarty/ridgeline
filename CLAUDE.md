# Design Philosophy

Prefer to optimize for the happy path while staying as flexible as possible -- both in terms of user-computer interface and internal module relationships and composability. Don't assume future needs, but don't close doors either. Keep modules composable with full interfaces (e.g., keep pause/resume even if current usage only needs stop).

- When designing interfaces, expose the full capability set (stop/pause/resume, not just stop).
- When integrating, use the simplest path that works, but don't strip flexibility from the underlying module.
- Fold universal features into defaults, not flags/commands.
