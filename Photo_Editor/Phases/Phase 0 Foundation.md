---
tags: [phase]
---

# Phase 0 — Foundation ✅

The trusted domain core: a deterministic, validated, reversible, replayable
project-operation engine.

**Built:**
- [[Packages/canonical-json]], [[Packages/project-schema]],
  [[Packages/command-schema]], [[Packages/editor-state]].
- Rust: [[Crates/timeline-engine]], [[Crates/project-store]], and the type layer
  of [[Crates/media-core]].
- [[Concepts/Command Engine]], [[Concepts/Undo Redo Replay]],
  [[Concepts/Determinism]], [[Concepts/Persistence]].

**Out of scope (later phases):** media decode, render, playback, audio, export,
auth, DB, cloud, AI.

Basis for everything else — see [[Phases/Roadmap]] and [[Rules/Non-negotiables]].

## Variable clip speed (2026-08-05)

The version-one restriction of `playbackRate` to exactly 1/1 is lifted: clips
retime between 1/4 and 4 via the new `timeline.set_clip_speed` command, with
`internal.set_clip_speed` as its inverse. Rates stay rationals in lowest terms,
so source-time arithmetic remains exact BigInt and canonical JSON stays unique.
Audio is resampled with the picture (varispeed); pitch-preserving stretch is
deliberately not implemented. See `docs/phases/clip-speed.md`.
