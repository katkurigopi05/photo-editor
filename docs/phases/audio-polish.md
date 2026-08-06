# Audio fades, EQ and compression

Phase 4 specified a per-clip effects chain (EQ, compressor) alongside gain and
pan; it was never built. This closes that gap and adds fades, including the
crossfades implied by overlapping two clips on one audio track. Added
2026-08-05.

## The state layer

Three new `EffectInstance` types, validated exactly like the visual ones:

| Type | Params |
| ---- | ------ |
| `audio.fade` | `fadeInUs`, `fadeOutUs` — canonical microsecond strings, like every other duration in the model |
| `audio.eq` | `lowGainDb`, `midGainDb`, `highGainDb` (±24 dB) |
| `audio.compressor` | `thresholdDb`, `ratio` (≥ 1:1), `attackMs`, `releaseMs`, `makeupGainDb` |

`isAudioEffectType()` in `packages/project-schema/src/effects.ts` is the single
place that says which side of the mix a type belongs to — the inspector, the
renderer and the export plan all ask it rather than each testing the prefix.

## Fades and crossfades

`packages/playback-controller/src/audio-envelope.ts` resolves a clip's fades:

- an authored `audio.fade` effect, and/or
- the overlap with a neighbouring clip on the same track, which becomes a
  crossfade — the longer of the two wins, so an authored fade is never silently
  shortened by a neighbour;
- both ends are scaled down proportionally if they would meet in the middle of a
  short clip.

The ramp is equal-power (`sin`), not linear: two correlated sources crossfading
linearly lose ~3 dB in the middle of the overlap, which is audible as a hole.
`audioEnvelopeGain()` samples one instant (live monitoring polls it at the
playhead) and `audioEnvelopeCurve()` produces the same shape as a curve for
`AudioParam.setValueCurveAtTime()` (the export uses it sample-accurately). One
implementation, so the monitor and the file cannot disagree.

## The audio graph

Both the live monitor and the offline mixdown build the same chain:

```
source → lowshelf(250 Hz) → peaking(1 kHz, Q 0.8) → highshelf(4 kHz)
       → compressor → gain (static dB + makeup, fade curve) → pan → destination
```

The nodes always exist and sit neutral when the clip has no audio effects.
That is not laziness: `createMediaElementSource` may only be called once per
element, so a graph that is rebuilt whenever an effect is added is a graph that
cannot be edited.

## Export

`AudioClipPlacement` in the export plan now carries the clip's audio effects and
its resolved fades, so the mixdown reads only the plan — the export stays
reproducible from a project version, per the Phase 6 non-negotiable.

## Tests

- `packages/playback-controller/test/audio-envelope.test.ts` — fade resolution,
  overlap-to-crossfade, proportional clamping, equal-power (`in² + out² = 1`),
  monotonicity, clamping outside the clip.
- `packages/project-schema/test/audio-effects.test.ts` — param ranges, the
  microsecond-string discipline, audio/visual classification.
- `packages/export-engine/test/audio-plan.test.ts` — the plan carries audio
  effects and resolved fades, and stays deterministic.
- `apps/web/e2e/audio.spec.ts` — drives the real inspector, then exports an MP4
  and **decodes its audio**: the first 0.4 s must be well below the level after
  the ramp. A fade that existed only in the monitor fails this test.
