# Navigable history panel

The operation log and replay have existed since the foundation. The panel over
them was a read-only list of raw command types that always marked its last row
as current — which stopped being true the moment anything was undone. This makes
it a control. Added 2026-08-12.

## A step is a gesture, not an operation

Ripple delete is a delete plus a move for every clip after it. Adding an
adjustment layer is a track, a move per clip, an asset registration and a clip.
Listing those separately would describe the engine rather than what the person
did — and would not match Undo, which already steps by gesture.

`EditorSession` gained `undoStepSizes()` and `redoStepSizes()`, which expose the
gesture boundaries it was already keeping privately for Undo. The panel draws one
entry per step and names it after the gesture's **first** command: that is the
one the person asked for, the rest are consequences.

`redoStepSizes()` is ordered nearest-first — index 0 is what the next Redo would
restore — because that is the order the panel draws forward from the present and
the order they come back.

## Stepping, not jumping

Clicking an entry calls Undo or Redo repeatedly until the present is there. It
would have been easy to replay the log to an arbitrary point instead, and that
would have been a second way of moving through history — two mechanisms that
could disagree. Stepping reuses exactly the path the buttons take, so a click
lands where pressing Undo that many times would. An e2e asserts precisely that
equivalence.

## The redo branch is drawn, not hidden

Steps ahead of the present stay in the list, dimmed and italic, and remain
clickable. Hiding them would make the way forward something you have to
remember, and would make the list change length under the pointer as you moved
through it.

`current` marks the step the project is standing on — the last done one, not the
last in the list. That was the old panel's bug, and there is a test for it.

## Labels

A map from command type to a human name, with a fallback that tidies the type
itself. A lookup with no fallback would make a newly added command show up as
nothing at all; this way it shows up readably and only slightly wrong.

## Tests

- `packages/ui-kit/test/session-history.test.ts` — one entry per command,
  gestures reported as a single step, an all-failed gesture contributing
  nothing, the redo side gaining and losing steps, a gesture staying whole
  across undo and redo, the branch emptying when a new command discards it, the
  total staying constant as the present moves, and the baseline excluded.
- `apps/web/e2e/history-panel.spec.ts` — labels rather than command types,
  clicking back, the branch staying listed and clickable forward, the current
  marker following the present rather than the end, and clicking a step matching
  the button.

## Not built

- **Naming a gesture better than its first command.** "Add clip" is right; a
  ripple delete reads as "Delete clip" rather than "Ripple delete", because the
  first command is the delete. Carrying an intent label on the gesture would fix
  it and means touching every call site that opens one.
- **Timestamps or grouping by session.** The log has `createdAt`; the panel does
  not show it.
- **Selective undo** — undoing step 3 while keeping 4 and 5. The engine's
  `undoStack` is documented as reserved for exactly that and does not do it yet.
