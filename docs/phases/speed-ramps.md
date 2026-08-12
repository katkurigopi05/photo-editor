# Speed ramps

A clip whose rate changes partway through: full speed into the action, quarter
speed across it, full speed out. Clip speed shipped one constant rational rate
per clip; this is the keyframed version the roadmap called for. Added
2026-08-11.

## Stepped, not smooth — the decision that shapes everything else

The rate is constant between boundaries and changes in steps. That is the design
rather than a shortcut, and it follows directly from what
[clip-speed.md](clip-speed.md) already committed to:

> A float rate would make the same clip resolve to different source times on
> different machines.

A **continuously interpolated** rate makes source position the *integral* of the
rate. Resolving a timeline instant back to a source instant then means solving a
quadratic — irrational results, on a model whose whole promise is that the same
clip resolves to the same source microsecond everywhere. Constant rational rates
keep every step exact BigInt arithmetic **in both directions**, which is what
`resolveAtTime`, the scrubber and the exporter all need.

A smooth ramp is still reachable later without breaking any of this: subdivide
the curve deterministically into many constant segments and store the
subdivision. That is a bigger feature than this one, and it is recorded under
*Not built* rather than half-done.

## Segments are anchored in source time

A segment is `{ id, sourceOffsetUs, rate }`, the offset measured from the clip's
own `sourceInUs`.

Source offsets do not move when a rate changes; every *timeline* offset after a
changed segment does. Anchor in timeline time and one edit rewrites every later
segment, and the inverse has to carry them all. Anchoring in source also means
trimming the clip does not renumber the ramp.

The first segment is always at offset 0 — the span before it would otherwise
have no rate at all — and offsets strictly increase.

## One ramp or one rate, never both

A ramp needs **at least two segments**. One rate for a whole clip is
`playbackRate`, which already has a spelling, and two ways to say one thing
would be two byte-different projects that render identically — which canonical
JSON cannot tell apart from two genuinely different projects.

For the same reason the two never coexist:

- setting a ramp pins `playbackRate` back to 1/1, because a leftover non-unit
  rate would silently scale every segment;
- `set_clip_speed` on a ramped clip is **refused**, rather than quietly
  discarding the ramp. Clearing it is a command of its own, and saying so beats
  losing work the person cannot see they have lost. The Inspector disables the
  constant picker while a ramp is live, so the UI never invites the refusal.

## Duration, and the two refusals

`timelineDurationUs` is the **sum of each segment's own stretch** — summed
rather than derived from an average rate, because the sum is what the playback
map actually walks; an average would drift from it by the rounding of every
segment it smoothed over.

Because a ramp resizes the clip, it is refused for the two reasons a constant
retime already was, now factored into one `retimeError` both commands call: a
lengthening that would collide with the next clip (`OVERLAP`), and a shortening
that would strand a keyframe past the new end (`OUT_OF_BOUNDS`). A segment
starting at or past the end of the source is refused too — it would describe no
frames.

The inverse carries the ramp, the displaced constant rate, **and the previous
duration verbatim**. Recomputing the duration on undo would repeat the forward
truncation instead of restoring the bytes that were there — the same trap
`internal.set_clip_speed` documents.

## Picture came free; sound did not

Every renderer already resolves frames through `resolveAtTime`, so teaching that
one function about ramps fixed the preview *and* the export in one change.
`sourceAtClipOffset` walks the segments and is the single place the mapping
lives, so the scrubber, the canvas and the exporter cannot disagree.

Audio was the opposite. A frame is *sampled at an instant*; a sound is
*scheduled as a span*, and `AudioBufferSourceNode.start(when, offset, duration)`
carries one rate per node. Left alone, a ramped clip would have kept
`playbackRate` 1/1 and played its audio at normal speed under a retimed picture
— a desync introduced by this feature rather than a pre-existing gap.

`rampSpans()` answers both clocks at once, and the export mixdown now builds
**one source node per span**, sharing one effects chain and one fade curve per
clip. An unramped clip yields exactly one span covering the whole thing, which
is what the mixdown always did. The live monitor takes the other route: an
`HTMLMediaElement` holds one rate at a time, so it re-reads `rateAtClipOffset`
at the playhead each tick and changes rate as a boundary is crossed.

## UI

The Speed section in the Inspector gains a segment list and "＋ Speed change at
playhead". The playhead is the anchor because it is where you are already
looking: scrub to the moment the action should slow, and say how much. What gets
recorded is the playhead's *source* position, since that is the coordinate a
ramp is written in.

A new boundary defaults to 0.5×, because the point of adding one is to change
the rate and 1× would look like nothing happened. The first segment's remove
button is disabled — it is the clip's opening rate. Removing down to one segment
clears the ramp rather than leaving an illegal one-segment array.

Every action rebuilds the whole ramp and issues one command, wrapped in the same
ripple gesture constant retiming uses: lengthening moves the following clips out
of the way first, shortening closes the gap afterwards, and one Undo covers it.

**A rough edge worth naming:** selecting a clip moves the playhead to that
clip's start, so the add button is disabled immediately after selecting until
you scrub. The tooltip says why. Fixing it properly means letting the Inspector
target a position independent of selection, which is a bigger change than this.

## Tests

- `packages/project-schema/test/speed-ramp.test.ts` — schema rules, the duration
  sum, and the mapping: exact source instants at segment boundaries and inside
  segments, **monotonicity across the whole clip** (a ramp that went backwards
  would show the shot running in reverse at a seam), the unramped fallback, and
  spans covering exactly the clip's duration — a gap there is a gap in the
  mixdown.
- `packages/editor-state/test/speed-ramp.test.ts` — resizing, the source range
  left alone, the rate pinned to 1/1, clearing to an absent member, both
  refusals, byte-exact undo including the case where a ramp replaced an odd
  constant rate (3/7, chosen because it truncates), replay, and
  `set_clip_speed` refused on a ramped clip.
- `apps/web/e2e/speed-ramp.spec.ts` — the Inspector reaching the command, one
  undo, clearing, the constant picker disabled, and **the picture actually
  retimed**: the frame three-quarters through the ramped clip differs from the
  frame three-quarters through it before. A duration assertion alone would pass
  for a clip merely drawn longer.

## Not built

- **Smooth ramps.** See the top: reachable by deterministic subdivision into
  constant segments, at the cost of a much larger stored ramp (a 5 s ease at
  30 fps is ~150 segments). Sized L, not M.
- **Dragging a boundary.** Rates are edited from a picker and boundaries are
  added at the playhead; moving one means re-issuing the ramp, which the command
  already supports but no control offers.
- **A retime curve view.** The segment list is a list, not a graph.
- **Pitch preservation** — unchanged from [clip-speed.md](clip-speed.md): audio
  is resampled with the picture, so a slowed segment drops in pitch.
