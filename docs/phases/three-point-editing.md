# Three-point editing

Insert, overwrite and append: choosing *where* a clip lands and what happens to
what is already there. The browser range was the source half — in and out chosen
before anything reaches the timeline — and this is the destination half. Added
2026-08-10.

Three points decide an edit: source in, source out, and a destination. The
fourth is derived. Here the first two come from the bin's range and the third
from the playhead.

## Two commands, not a composed gesture

`add_clip` refuses with OVERLAP when something is already there. Insert and
overwrite are the two answers to "so what should happen to it", and each is one
command:

- `timeline.insert_clip` — everything at or after the point moves later by the
  clip's duration.
- `timeline.overwrite_clip` — clips inside the span go, clips across either edge
  are trimmed back, a clip containing the whole span is cut in two.

Append needed nothing new. It is `add_clip` at the end of the track, which is
what adding from the bin already did.

**The honest alternative was a UI-composed gesture.** `session.beginGesture()`
already groups several commands into one undo — ripple delete uses it — so
"one undo" alone did not force new commands. Three things did:

- **Atomicity.** A gesture is several commands, each validated separately; half
  of a ripple can succeed. One command either applies or does not.
- **The agent surface.** The MCP server exposes one tool per public command. A
  UI-composed insert would be an edit an agent could not make without
  reimplementing the ripple, trim and split arithmetic — and the tool-coverage
  test exists precisely because that gap once went unnoticed for five commands.
- **It is one thing.** "Insert here" is a single intent, and the operation log
  reads better recording it as one.

## Where the ripple stops

**Insert ripples only its own track.** Rippling every track is the magnetic
timeline — step M1 on the feature map, and explicitly "a decision before a
task: it changes what a track *is*". A lane here is independent, so an insert on
V1 leaves V2 alone. A test asserts it, so the day the magnetic timeline arrives
this is a deliberate change rather than a surprise.

## Cutting a clip in two

An edit landing mid-clip has to split it, and a split needs an id for the second
half. Reducers never invent identity — no clock, no randomness, Rule 6 — so
`splitClipId` is supplied in the payload. When no split is needed it is ignored;
when one is needed and it is absent the command is **refused with a message
naming the clip**, rather than guessing an id that would not replay.

The web UI supplies one on every insert and overwrite. Predicting whether a
split is needed would mean duplicating the reducer's own arithmetic in the
caller, which is the kind of second opinion that eventually disagrees.

### Rounding, and which way it goes

Cutting at a timeline instant means cutting at a source instant too, and at a
playback rate other than 1/1 the two do not divide evenly. **Timeline durations
are kept exact — the halves sum to the original — and the source point absorbs
the rounding.** The other way round would leave a sub-microsecond gap or overlap
on the timeline, which is visible and which every downstream invariant cares
about; a sub-microsecond source error is not. At the ordinary rate of 1/1
nothing rounds at all.

A clip trimmed at the *end* edge of an overwrite has its `sourceInUs` advanced
with the cut. Without that it would restart from its old in-point and replay the
frames the overwrite just covered.

### What each half of a cut clip keeps

The first version of `cutClip` spread the whole clip onto both halves. That is
wrong for anything belonging to *one end* or *one moment* of it, and it was
caught by asking what a decorated clip would do rather than by a failing test —
nothing covered it, which is why the tests now do.

| Carried | Goes to | Why |
| --- | --- | --- |
| `transitionIn` | left half only | Its start is still the clip's original start. On the right half it would ramp against an inner edge that does not exist, and could exceed the shorter half — the thing `transitionsFitClip` forbids wherever it is checked. |
| `transitionOut` | right half only | Same argument, other end. |
| Markers | the half they fall in, **rebased** | Times are clip-local. Left as they were, a marker past the cut would point beyond the left half's end. |
| Effects, masks, blend mode | both halves | Both still show the picture those describe. |
| Animations | **neither — the cut is refused** | See below. |

**Animated clips are refused, not guessed at.** `trim_clip` already refuses to
strand a keyframe past a shortened clip, so reaching that state by another route
would be inconsistent — and a cut is worse than a trim, because the right half's
start moves and every clip-local keyframe on it would need rebasing onto a
timeline the animation was never authored against. Dropping the animation loses
work silently; splitting it invents an interpolation nobody asked for. The error
names the clip and says to move the edit to its edge. A boundary edit cuts
nothing, so this only ever blocks a mid-clip one, and a test covers both sides of
that line.

An overwrite that covers a clip *entirely* is exempt: that clip is deleted, and
deleting an animated clip has always been allowed.

## The inverse

One inverse for both: `internal.set_track_clips`, restoring the track's whole
clip list. The same bargain masks, markers and keyword ranges strike — these
commands rearrange an unbounded number of clips, so carrying the list entire
buys exact undo without a reconstruction rule per case, and a track's clips are
small next to the media they point at.

## Tests

- `packages/editor-state/test/three-point-edit.test.ts` — ripple at a boundary
  and at zero, the mid-clip split with its source continuity, the refusal when
  no `splitClipId` was given, a split id already in use, other tracks staying
  put, and for overwrite: full cover, both edges separately, and the span
  falling wholly inside one clip. Both commands share unknown-track,
  duplicate-id, bad-source-range, one-step undo and replay.
- `apps/web/e2e/three-point-edit.spec.ts` — the toolbar reaching both commands,
  and the property that separates them: **insert grows the sequence by exactly
  the inserted length, overwrite leaves it the same**. Also that a ripple across
  three clips is one press of Undo.

Clip elements now carry `data-start-us` beside `data-duration-us`. A ripple is a
change of *position*, and reading it off `style.left` would be reading the zoom
level back out.

## A test that was wrong in an instructive way

The boundary-insert check first scrubbed to five-sixths of a six-second
sequence, meaning to land on 5.000s. It lands on 4.998s — inside the first clip
— so the insert split it, correctly, and the test failed asserting three clips
where there were four. Selecting a clip puts the playhead on its start to the
microsecond, which is what the test now does. The failure was worth having: it
exercised the mid-clip split from the UI before the test written for that case
ran.

## Not built

- **Backtimed edits** — supplying source out and a destination out, letting the
  in-point derive. The fourth-point arithmetic is the same; only the UI for
  saying which three you mean is missing.
- **Three-point from the timeline's own in/out** — there is no sequence-level in
  and out yet, so the destination is the playhead alone.
- **Insert across tracks** — see the magnetic timeline note above.
- **Split is still two commands.** `btn-split` composes trim + add in the UI and
  is not wrapped in a gesture, so it costs two undo steps. `cutClip` in the
  reducer now does exactly this arithmetic in one place; folding the button onto
  a real split command would be a small, separate change.
