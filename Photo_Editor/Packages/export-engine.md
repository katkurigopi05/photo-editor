---
tags: [package, phase-6]
---

# @director/export-engine

The [[Phases/Phase 6 Export|Phase 6]] headless planning core — pure and
deterministic. An export depends only on a specific [[Data Model/Project|project]]
version + a preset, never on live playback/UI ([[Concepts/Determinism]]).

- **Presets:** Zod-validated, JSON-serializable — resolution, frame rate, video
  codec, container, bitrate, audio codec/sample rate; `isCodecContainerCompatible`.
- **`planExport`:** `{ framesTotal, durationUs, audioSampleCount, audioClips,
  projectVersion }`, reproducible; `planVideoFrames` gives per-frame render
  requests for a bounded range (via [[Packages/playback-controller]]).
- **Export job:** `startExport`/`advanceExport`/`failExport`/`cancelExport` —
  stateful job **outside** the [[Concepts/Command Engine]] (like playback);
  cancelled/failed is never a finished output.

Mux timestamp math lives in the Rust [[Crates/export-engine]]
(`frame_pts_us` / `timestamp_table`). No actual encode/mux.
