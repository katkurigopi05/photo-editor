---
tags: [concept]
---

# Undo / Redo / Replay

## Undo
Applies the last [[Concepts/Project Operation|operation]]'s inverse, sets
`currentVersion` back to `baseVersion` (undoing `project.create` → `project:
null`), pops the log/undo stack, pushes onto the redo stack. Empty → `HISTORY_EMPTY`.

## Redo
Re-executes the operation's original forward command. It was valid at this
version before, so it must succeed; otherwise `OPERATION_LOG_INVALID`.

## Replay
`replay(log)` rebuilds state from empty:
1. Validate each [[Concepts/Project Operation|operation]] structure.
2. Validate chain continuity (versions, `id`/`createdAt` match the command).
3. Execute each forward command.
4. Byte-compare recomputed version + inverse against the recorded ones via
   [[Concepts/Canonical JSON]] → mismatch is `OPERATION_LOG_INVALID`.

Because it recomputes, replay never trusts recorded metadata — tampering with
`id`, `baseVersion`, `resultingVersion`, command, or inverse is detected. This is
the core of [[Concepts/Determinism]].
