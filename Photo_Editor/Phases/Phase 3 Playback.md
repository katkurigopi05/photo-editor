---
tags: [phase]
---

# Phase 3 — Playback & Scrubbing 🟡

Turns playhead navigation into deterministic frame requests at interactive
speeds. Full stack needs Phase 1 decode + Phase 2 render at runtime; the
**transport core** is built now in [[Packages/playback-controller]].

**Boundary (non-negotiable):** playback state (time, play/pause, loop, rate) is
session state — not in [[Data Model/Project]], not through the
[[Concepts/Command Engine]], not in the operation log. Undo/redo and replay are
untouched. Nothing reads the clock ([[Concepts/Determinism]]).

**Built:** frame↔time math (exact `bigint`, non-integer rates),
[[Data Model/TimelineClip|clip]] resolution at a time (half-open, source-time
mapped), transport reducers (seek/clamp/loop-wrap/stop), deterministic prefetch
planner.

**Remaining:** async decode scheduler, A/V sync to an audio clock, proxy
scrubbing — need real media, not stubbed.

See [[Phases/Roadmap]].
