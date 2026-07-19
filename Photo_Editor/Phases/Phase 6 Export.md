---
tags: [phase]
---

# Phase 6 — Export 🟡

Encode + mux a project version to a file. The **headless planning core** is built
now; actual encoding/muxing needs codec libraries and is future work.

**Boundary (non-negotiable):** an export depends only on a specific
[[Data Model/Project|project]] version + preset — never on live playback/UI — so
it is reproducible and can run headless. Progress/cancellation is a job
**outside** the [[Concepts/Command Engine]]; failures are typed; a cancelled or
failed job is never a finished output.

**Built:** [[Packages/export-engine]] — Zod-validated presets + codec/container
matrix, `planExport` (deterministic frame/audio schedule bound to a version),
`planVideoFrames`, and an export-job state machine. [[Crates/export-engine]] —
codec/container types + `frame_pts_us` / `timestamp_table` from the canonical
microsecond model.

**Remaining:** real H.264/H.265/VP9/AV1 encode, MP4/MOV/WebM mux, and round-trip
re-decode verification — need codec libraries + fixtures, not stubbed.

See [[Phases/Roadmap]].
