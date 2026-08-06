# Timeline editing: snapping, trimming, rippling, multi-select

Phase 5 shipped clip drag, split and delete. This adds the gestures an editor
reaches for between those: snapping, trim handles, ripple trim, ripple delete
and multi-clip selection. Added 2026-08-05.

## Arithmetic, not pixels

`packages/ui-kit/src/timeline-edit.ts` holds the whole of it as pure functions
over project state:

- `collectSnapTargets(sequence, excludeClipIds, playheadUs)` — the origin, the
  playhead, and both edges of every other clip, including clips on other tracks
  (aligning a cut across tracks is the main reason to snap at all).
- `snapClipStart(candidateStartUs, durationUs, targets, toleranceUs)` — snaps
  **either** edge of the dragged clip. Snapping only the head is the classic
  one-frame-gap bug: a clip dropped so its tail nearly meets the next clip has
  to close that seam.
- `planRippleDelete(track, clipId)` and `planRippleTrim(track, clipId,
  newDurationUs)` — the moves that keep the rest of the track in step.

The pointer handler converts a gesture to a candidate time, asks these what the
time should be, and dispatches ordinary validated commands. No new command types
were needed.

## Move ordering is a correctness property

Ripple moves are applied as separate `timeline.move_clip` commands, and the
reducer rejects overlaps. So a ripple that shortens the track must move clips
left to right, and one that lengthens it must move them right to left — the far
clip has to vacate before its neighbour arrives. The planners return the moves
already in that order, and the tests pin it.

The tolerance is 8 px converted to time at the current zoom, so the magnet feels
the same zoomed in or out. Hold Alt while dropping to skip it.

## One gesture, one Undo

A ripple delete is one keypress but several commands. Rather than weaken the
engine's contract — one command, one inverse, one version, which replay and the
persisted log depend on — `EditorSession` records how many operations each undo
step covers (`beginGesture()` / `endGesture()`). `undo()` walks back through the
group using the ordinary engine undo, and `redo()` restores it. The operation
log is untouched; grouping is session state, like selection or playback.

The invariant is that the recorded step sizes sum to the operation log length,
which is what keeps a later single command from being swallowed by an earlier
group.

## UI

- Trim handles are 8 px strips on each clip edge, revealed on hover or
  selection, that stop the pointerdown from reaching the clip's own drag
  handler.
- Trimming the head also moves the clip's timeline start by the same amount, in
  the same gesture, so the remaining frames stay where they were.
- Shift/Cmd-click builds a multi-selection; `selectedClipId` remains the clip the
  Inspector edits.
- `⇤ Ripple Delete` sits next to Delete in the timeline toolbar; Shift+Delete is
  the keyboard equivalent.

## Tests

- `packages/ui-kit/test/timeline-edit.test.ts` — snap targets and exclusions,
  head/tail snapping, nearest-wins, ripple move sets and their ordering.
- `packages/ui-kit/test/session-groups.test.ts` — one operation per command
  still, one Undo per gesture, ungrouped commands unaffected, empty gestures
  discarded.
- `apps/web/e2e/timeline-edit.spec.ts` — real pointer drags: a clip snaps flush
  to its neighbour, Alt drops it where released, a trim handle shortens instead
  of moving, ripple delete closes the gap and one Undo restores all three clips,
  and shift-click deletes two clips as a single step.
