# Magnetic tracks

A track can be marked magnetic: its clips stay packed end to end, so deleting
one closes the gap, inserting one pushes the rest along, and dragging one past a
neighbour reorders them. Added 2026-08-12.

## Per track, not per timeline

Final Cut's model is one primary storyline plus clips *connected* to it. That
changes what a track **is**, and with it the overlap rule every existing command
is written against — adjustment layers sitting above a lane, three-point insert
and overwrite, compound clips, the lot.

Per track coexists instead. An unmarked track behaves exactly as it always did,
so everything already built keeps working and every existing test stays
meaningful. It was a decision worth taking deliberately rather than defaulting
into.

## One invariant

**On a magnetic track, each clip starts where the previous one ended.**

Delete closes the gap, insert pushes, drag past a neighbour reorders — none of
which needs a rule of its own. A test asserts the invariant directly, walking
the clips and checking each start equals the running total, rather than only
checking examples.

Order comes from position, so a drag decides the order and the packing decides
the positions.

### The tie-break that was wrong

Two clips can share a start honestly: inserting one exactly where another begins
is the normal case. The first version tie-broke on clip id, which answers "which
came first" alphabetically — arbitrarily — and put the clip being *pushed* ahead
of the clip *arriving*. The sort is now stable with no tie-break, so the
caller's ordering decides.

Deliberately unlike `sortClips` in the reducer, which does tie-break on id
because it orders a set that may not overlap at all.

## Where it is applied, and the claim that was wrong

The previous commit claimed every track write funnels through `replaceTrack`, so
packing there would make the invariant hold by construction. **That was wrong**,
and a test caught it: `move_clip` builds its tracks inline — it may touch two at
once — and never calls `replaceTrack`, so dragging past a neighbour left the clip
exactly where it was dropped, gap and all.

There are three write paths. `replaceTrack` and `mapTrack` normalize, and the
move's own inline rewrite does too. The third is the candidate project
`compoundCycleError` builds to ask a hypothetical question — never committed,
and correctly left unpacked.

The lesson is worth keeping: "all writes go through X" is a claim to verify, not
to assert.

## Undo

Normalizing inside `mapTrack` is safe on the undo path, because any state
committed to a magnetic track was packed when it was written — packing it again
is a no-op.

The one exception is `internal.set_track_magnetic`, which restores a genuinely
*unpacked* track: turning the flag off does not un-pack, so undo has to put the
gaps back, and they cannot be derived from a packed track. Its inverse therefore
carries the clip positions as well as the flag, and it writes the track
directly, bypassing the helper — applying the invariant there is precisely what
undo is trying to reverse.

## Details

- Turning it on **packs immediately**, so the toggle visibly does something
  rather than waiting for the next edit.
- Turning it off leaves the clips where the packing put them. Un-packing would
  have to invent gaps that no longer exist anywhere in the project.
- The flag is stored **absent rather than false** when off, since an untouched
  track carries no member and canonical JSON treats the two as different
  projects.
- `normalizeTrack` returns the same object when nothing moved, so a no-op edit
  does not make byte-identical state look like a change.
- The toggle lives on the track head, because magnetic is a property of a track
  and a global control would have to ask which one.

## Tests

- `packages/project-schema/test/magnetic.test.ts` — the packing itself: gaps
  closed, inserts pushing, reorder by position, an already-packed track left
  alone, and the invariant asserted directly.
- `packages/editor-state/test/magnetic.test.ts` — the invariant surviving **real
  commands**, which is the part that matters: delete closes the gap and move
  reorders, and neither `delete_clip` nor `move_clip` knows magnetism exists.
  Plus byte-exact undo and the absent-not-false storage.
- `apps/web/e2e/magnetic.spec.ts` — an ordinary track keeping its gaps, deleting
  closing them on a magnetic one, packing on toggle, and the toggle's state
  surviving undo.

## Not built

- **Connected clips.** A title that follows the clip it annotates is the other
  half of Final Cut's model and is a relation in the schema, not a track flag.
- **Magnetic across tracks.** Rippling every track together is the storyline
  model, which is the thing this deliberately did not do.
- **A default.** New tracks are ordinary; nothing decides for you.
