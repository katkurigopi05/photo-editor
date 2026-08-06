# Clip speed (retiming)

Foundation pinned `playbackRate` to exactly 1/1 and the roadmap flagged variable
rate as a real design decision rather than a default. This implements it:
0.25×–4× per clip, with the pitch question answered explicitly. Added
2026-08-05.

## The rate is a rational, in lowest terms

`clipPlaybackRateSchema` (`packages/project-schema/src/primitives.ts`) accepts a
rational between 1/4 and 4 whose numerator and denominator are coprime.

- **Rational, not float** — every source-time computation is
  `sourceIn + offset × numerator / denominator` in exact BigInt arithmetic
  (`resolveAtTime` already did this). A float rate would make the same clip
  resolve to different source times on different machines.
- **Lowest terms** — one speed must have exactly one spelling, or canonical JSON
  stops being canonical and two byte-different projects would be equal. 2/2 is
  refused rather than silently reduced, matching how the v1 unit-rate schema
  refused unreduced equivalents.
- **1/4 to 4** — beyond 4× the decoder is asked for frames faster than it can
  supply them; below 0.25× the result is a slideshow. Both are better refused
  than delivered badly.

Projects written before this change carry exactly 1/1 and parse unchanged.

## `timeline.set_clip_speed`

New public command; new `internal.set_clip_speed` inverse. The reducer:

1. recomputes `timelineDurationUs = (sourceOut − sourceIn) × den / num`,
2. refuses a lengthening that would overlap the following clip (`OVERLAP`),
3. refuses a shortening that would strand a keyframe past the new end
   (`OUT_OF_BOUNDS`) — the rule trimming already enforced,
4. leaves the source range alone: speed changes how the same frames are spread
   over the timeline, not which frames are used.

The inverse carries the **previous duration verbatim** rather than recomputing
it. The forward division truncates at sub-microsecond precision; recomputing on
undo would repeat the truncation and undo would not restore the original bytes.
The replay test pins this.

## Pitch: varispeed, not time-stretch

Audio is resampled with the picture — `HTMLMediaElement.playbackRate` when
monitoring, `AudioBufferSourceNode.playbackRate` in the export mixdown — so a
slowed clip drops in pitch, like dragging tape. Pitch-preserving time-stretch is
a different device (phase vocoder or WSOLA) with its own artefacts and
parameters; it is deliberately not implemented, and the Inspector says so rather
than leaving users to discover it.

The export mixdown distinguishes the two durations carefully:
`AudioBufferSourceNode.start(when, offset, duration)` takes **source** duration,
so it gets the untimed span, while the fade curve spans the **timeline**
duration.

## UI

A Speed section in the Inspector offers discrete presets (0.25×, 0.5×, 0.75×,
1×, 1.5×, 2×, 4×) — discrete because the rate must be a reduced rational, and a
free slider would have to invent a denominator per position, most of which the
schema would refuse. The change is issued as one gesture: when slowing, the
following clips ripple out of the way *before* the retime (or the reducer would
refuse it); when speeding up, they ripple in afterwards to close the gap. One
Undo covers the lot.

## Tests

- `packages/project-schema/test/playback-rate.test.ts` — range, lowest terms,
  backward compatibility with 1/1.
- `packages/editor-state/test/clip-speed.test.ts` — duration recomputation both
  ways, overlap refusal, byte-exact undo, byte-exact replay.
- `packages/mcp-server/test/tool-coverage.test.ts` — the pre-existing gate that
  caught the missing `set_clip_speed` tool the moment the command existed.
- `apps/web/e2e/clip-speed.spec.ts` — the clip's box halves at 2×, one Undo
  restores it, the preview shows a different source frame at the same instant
  after retiming, and an exported MP4 of a 5 s clip at 2× is ~2.5 s long.
