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

Added via `timeline.add_clip`; edited via move/trim/delete. See
[[Concepts/Command Engine]].
