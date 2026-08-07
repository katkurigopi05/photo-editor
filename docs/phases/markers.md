# Markers

Notes pinned to moments of a clip — Final Cut's markers, and the first of its
timeline features to be adopted here. Added 2026-08-07.

## Clip-local, not timeline-local

A marker's time is clip-local microseconds, the same coordinate space keyframes
use. That is the decision the rest follows from: markers ride the clip, so
moving or trimming it carries the notes along and nothing has to be rewritten.
A timeline position would have to be adjusted on every move, and would drift the
first time an adjustment was missed.

The e2e pins it directly: trim the tail in, and the pin's *fraction* along the
clip grows while the time it shows does not change.

## Kinds

`standard` is a note. `chapter` is a navigation point an export can carry one
day. `todo` is a note with a `done` flag — absent rather than false until it is
ticked, so a project written before anything was ticked parses byte-identically.
Nothing else earns a kind; colour and rating both belong to other features.

## Rules the reducer holds

- A marker must fall inside the clip. Half-open, like every other range in the
  model: `0` is accepted, the duration itself is not. A note past the end would
  be invisible, unreachable, and would survive every trim.
- Ids are unique per clip, but two markers may share an instant — two notes
  about the same frame is ordinary.
- The list is sorted by time on write, so the timeline overlay and the
  inspector list read it straight and the operation log reads in the order a
  person expects.
- One inverse, `internal.set_clip_markers`, restores the whole list, including
  the difference between no markers and an empty list. Same reasoning as masks:
  the list is small, and carrying it entire buys exact undo without a
  reconstruction rule per command.

## Surfaces

Pins along the clip's foot — clear of the keyframe diamonds on its top edge, so
a clip can carry both. Clicking one moves the playhead to it. The Inspector
lists them with a time button, an editable name (committed on change, not on
keystroke, so one undo is one rename) and a tick for to-dos. `M` drops a note at
the playhead, `Shift+M` a to-do.

Adding is refused with a sentence when the playhead is outside the selected
clip, rather than by handing the reducer a time it will reject.

## Tests

- `packages/project-schema/test/markers.test.ts` — kinds, canonical times,
  name limits, the optional `done`, uniqueness within a clip.
- `packages/editor-state/test/markers.test.ts` — the three commands, the
  half-open bound at both ends, ordering on write, byte-exact undo including
  undo back to *no* markers field, and replay.
- `apps/web/e2e/markers.spec.ts` — `M` at the playhead, the pin's position on
  the clip, surviving a trim, click-to-seek, and ticking a to-do with undo.

## Not built

Timeline markers (as opposed to clip markers), marker ranges, chapter markers
carried into an exported MP4's chapter list, and filtering the timeline by
to-do. The kind is stored so those can arrive without a migration.
