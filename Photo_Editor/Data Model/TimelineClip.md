---
tags: [data-model]
---

# TimelineClip

A placed, trimmed reference to a [[Data Model/MediaAsset|asset]] on a
[[Data Model/Track]].

```ts
interface TimelineClip {
  id: string;
  assetId: string;
  trackId: string;
  timelineStartUs: string;
  timelineDurationUs: string; // derived: sourceOutUs - sourceInUs
  sourceInUs: string;
  sourceOutUs: string;
  playbackRate: Rational;     // v1: exactly 1/1
  effects: EffectInstance[];  // ordered stack (Phase 2)
}
```

- Times are [[Data Model/Microseconds|canonical microsecond strings]].
- `timelineDurationUs` is derived; callers cannot supply it.
- Bounds: `0 <= sourceInUs < sourceOutUs <= asset.durationUs`.
- **Overlap:** half-open `[start, start + duration)`; adjacency allowed, overlap
  rejected.
- Deterministic order: `timelineStartUs`, then `id`.
- Carries [[Data Model/EffectInstance|effects]].
- Carries audio state (Phase 4): `audioGainDb` (default 0, [-60, 12]) and
  `audioPan` (default 0, [-1, 1]), edited via `timeline.set_clip_audio_gain` /
  `timeline.set_clip_audio_pan`. See [[Phases/Phase 4 Audio]] and
  [[Crates/audio-engine]].

Added via `timeline.add_clip`; edited via move/trim/delete. See
[[Concepts/Command Engine]].
