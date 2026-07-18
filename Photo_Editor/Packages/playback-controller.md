---
tags: [package, phase-3]
---

# @director/playback-controller

The [[Phases/Phase 3 Playback|Phase 3]] transport core — pure, deterministic, and
**outside** the [[Concepts/Command Engine]]. Playback is session state, never in
[[Data Model/Project]] or the operation log.

- **Frame timing:** `timeToFrameIndex`, `frameToStartTimeUs`, `framesInDuration`
  — exact `bigint` math over a [[Data Model/Rational|frame rate]]; non-integer
  rates (30000/1001) round-trip precisely.
- **Timeline resolution:** `resolveAtTime` (active clip + mapped source time per
  track, half-open) and `sequenceDurationUs`.
- **Transport:** `PlaybackState` + reducers `play`/`pause`/`seek`/`setRate`/
  `setLoopRegion`/`tick` (clamp, stop-at-end, loop wrap).
- **Prefetch:** `planPrefetch` — deterministic frame-request schedule, planning
  only.

Reads a [[Data Model/Sequence]] snapshot; depends on [[Packages/project-schema]].
Nothing here reads the clock. See [[Concepts/Determinism]].
