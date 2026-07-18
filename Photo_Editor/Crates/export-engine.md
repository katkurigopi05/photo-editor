---
tags: [crate, phase-6]
---

# export-engine

Deterministic export timestamp/mux planning — the Rust side of
[[Phases/Phase 6 Export]]. Pure, no encode/mux/IO.

- `Container` / `VideoCodec` enums + `Container::accepts` (the codec/container
  matrix, mirrored by [[Packages/export-engine]]).
- `frame_pts_us(frame, num, den)` — presentation timestamp from the canonical
  [[Data Model/Microseconds|microsecond]] model.
- `timestamp_table(count, num, den)` — the strictly-increasing PTS table a real
  muxer lays out.

Actual encoding/muxing needs codec libraries and is future work.
