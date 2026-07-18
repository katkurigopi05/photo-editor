# Undo / Redo / Replay Semantics

## Undo

`undo(state)`:

1. If `operationLog` is empty → `HISTORY_EMPTY`.
2. Take the last operation, apply its recorded `inverse` to the project.
3. Set `currentVersion` back to the operation's `baseVersion` (undoing
   `project.create` returns `project` to `null`).
4. Pop `operationLog` and `undoStack`; push the operation onto `redoStack`.

The inverse restores structure, `updatedAt` (via `restoreUpdatedAt`), and exact
array positions (via `insertionIndex` where relevant).

## Redo

`redo(state)`:

1. If `redoStack` is empty → `HISTORY_EMPTY`.
2. Re-execute the operation's original forward command against current state.
   Because it was valid against exactly this version before, it must succeed; if
   it does not, the log is corrupt → `OPERATION_LOG_INVALID` (state unchanged).
3. Push the operation back onto `operationLog`/`undoStack`; pop `redoStack`.

## Redo-branch invariant

Any successful new command via `executeCommand` clears `redoStack`.

## Replay

`replay(operationsInput)` reconstructs state from an empty project:

1. If the input is not an array → `OPERATION_LOG_INVALID`, `operationIndex: -1`.
2. For each element, validate its `ProjectOperation` structure (Zod) →
   `OPERATION_LOG_INVALID` with the element index.
3. Validate chain continuity: first `baseVersion` is `0`; each
   `resultingVersion === baseVersion + 1`; each subsequent `baseVersion` equals
   the prior `resultingVersion`; each operation's `id`/`createdAt` equal its
   embedded command's values.
4. Reconstruct by executing each forward command.
5. After each step, verify the recorded `resultingVersion` matches the produced
   version and the recorded `inverse` is **byte-equal** (canonical JSON) to the
   freshly computed inverse. Any mismatch → `OPERATION_LOG_INVALID`.

Because inverses and versions are recomputed and compared, replay never trusts
recorded metadata; tampering with `id`, `baseVersion`, `resultingVersion`, the
command, or the inverse is detected.

## Determinism guarantee

Two independent executions of the same command sequence, and a replay of the
serialized log after a JSON round trip, all produce byte-identical canonical
JSON.
