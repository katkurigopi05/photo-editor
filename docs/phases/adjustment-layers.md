# Adjustment layers

A clip with no picture of its own, whose effects apply to everything beneath it.
Blend modes made a stack of clips composite; this is the other half — a grade
that lives on the timeline rather than on one clip, so it can be moved, trimmed,
faded and keyframed like anything else. Added 2026-08-11.

## An asset kind, not a flag on the clip

`assetKindSchema` gains `adjustment`. A clip pointing at one is an **ordinary
clip**, and that is the whole reason the state layer needed almost nothing: add,
trim, move, delete, effects, masks, blend mode, opacity and animation already
work on it, and not one reducer had to learn a new case.

The alternative — a boolean on the clip — would have meant every reducer that
touches a clip growing a branch for "but not if it is an adjustment", which is
the kind of condition that gets forgotten in exactly one place.

Only the compatibility rule changed: an adjustment layer belongs on a video
track and is refused on an audio one, where there would be nothing to adjust and
all its effects are visual.

## Reading the canvas is the whole mechanism

The render loop already paints **beneath-first** — resolve order is ascending
track index, and the loop reverses it, so the lowest index is painted last and
ends on top. By the time an adjustment layer's turn comes, everything below it
is on the canvas and nothing above it is.

So the layer reads the canvas back at that moment. That *is* "the composite of
everything beneath", with no accumulation buffer and no second pass. Its effects
run over the snapshot and the result is drawn back.

Its own opacity, transition ramp and blend mode apply to the adjusted copy on
its way back down, which is what makes a half-opacity adjustment layer mean
"half the grade" and a Multiply one mean "darken by the grade" — rather than
either being a special case.

### The comment that was wrong

`drawPreview` said *"Paint highest track index last (on top)"*. The code does the
opposite, and `blend-modes.md` had already described the real behaviour. The
comment is corrected, because this feature is unreadable without the fact.

### Why the grade cache had to be bypassed

`grade()` keys its cache on the *source*, which is sound for media: a clip's
picture at a given source time is the same picture every time it is asked for.
An adjustment layer's source is the live canvas — different pixels on every
frame, and often on every repaint of one frame. A cache would return a stale
grade or grow without bound, so `gradeUncached()` was split out and the
adjustment path calls it directly.

## One dispatcher, three render paths

`paintLayer()` routes to `drawAdjustmentLayer` or `drawLayer` and **every**
render path calls it — preview, MP4 and GIF. That is the same reason `drawLayer`
was shared to begin with: a feature that worked in the preview and was missing
from the export is exactly the class of bug the e2e suite exists to catch.

## Getting it above the clips

The snag, and the reason this needed a decision rather than a default: an
adjustment layer must sit at a **lower** track index than what it adjusts, index
0 is the default media track, and `add_track` enforces unique indices while the
app's "+ Track" always appends beneath. Nothing could reorder tracks.

"＋ Adjustment" therefore does it with the commands that already exist: add a
track beneath, move the top track's clips onto it, then place the adjustment on
the vacated top track. The whole run is one `beginGesture`, so it is **one
Undo**, and the picture is unchanged by the move — those clips were the only
visual content and they still composite in the same order.

The layer spans the whole sequence by default, because one covering part of the
cut would look like it had simply failed on the rest.

A proper `reorder_tracks` command remains the better long-term answer — it would
also give the app track dragging, which it cannot do at all — and is recorded
under *Not built* rather than half-done.

## Tests

- `packages/project-schema/test/adjustment-layer.test.ts` — the kind parses, an
  unknown kind still does not, and the compatibility matrix including every
  pre-existing rule, so widening the video case cannot quietly widen another.
- `apps/web/e2e/adjustment-layer.spec.ts` — the layer changes the picture
  beneath it, the arrangement it creates, one Undo, and the refusal on an empty
  timeline.

The measurement test is anchored on the frame **after** the layer is added, not
before it. Adding one seeks the playhead onto the new clip, so comparing against
the pre-add frame measures the seek rather than the layer — an assertion that
did exactly that was written, failed, and was removed rather than loosened.

## Not built

- **`reorder_tracks`.** See above. Without it, "＋ Adjustment" can only make room
  by moving clips down, which is a surprise however well it undoes.
- **Limiting the reach.** An adjustment layer affects every track beneath it.
  Premiere's model is the same; Resolve's node graph is not. Restricting one to
  the track directly below would need a target on the clip.
- **Adjustment layers in Photo mode.** The raster session is a separate local
  session outside the command engine, and this is timeline state.
