# Phase 6 — Export (presets + plan + job, built)

Real encode/mux needs codec libraries (ffmpeg/WASM encoders) and fixture files.
The **deterministic, headless planning core** is built now: validated presets, a
reproducible export plan bound to a project version, an export-job state machine,
and the mux timestamp math.

## Non-negotiable boundary

- An export depends only on a **specific project version** + a preset — never on
  live playback/UI state — so exports are reproducible and can run headless
  (e.g. later on `apps/api`).
- Progress/cancellation is a stateful job **outside** the command engine (like
  playback), reporting against the immutable version it started from.
- Failures are typed and recoverable; a cancelled/failed job is never treated as
  a finished output (no silent partial files).

## Built

`packages/export-engine` (pure TS):
- **Presets** (`preset.ts`): Zod-validated, JSON-serializable — resolution,
  frame rate, video codec, container, bitrate, audio codec/sample rate — plus
  `isCodecContainerCompatible` (the container/codec matrix).
- **Plan** (`plan.ts`): `planExport(project, sequenceId, preset)` →
  `{ framesTotal, durationUs, audioSampleCount, audioClips, projectVersion }`,
  deterministic and reproducible; `planVideoFrames` yields per-frame render
  requests for a bounded range (never materializes a whole export).
- **Job** (`job.ts`): `startExport` / `advanceExport` / `failExport` /
  `cancelExport`, with `hasCompletedOutput` — pure transitions, terminal states
  are sticky.

`crates/export-engine` (pure Rust): container/codec enums + `accepts` matrix,
and `frame_pts_us` / `timestamp_table` — presentation timestamps derived from the
canonical microsecond model (what a real muxer lays out). No encoding.

## Tests

Preset validation; codec/container matrix; plan determinism and a round-trip
fixture (known project → plan → exact frame/sample counts); SEQUENCE_NOT_FOUND /
EMPTY_SEQUENCE; job lifecycle incl. cancellation-leaves-no-output; Rust PTS
monotonicity and known values.

## Not built (rest of Phase 6)

Actual video/audio **encoding** and **muxing** (H.264/H.265/VP9/AV1, MP4/MOV/
WebM), and the round-trip re-decode verification — all need codec libraries and
fixtures, deliberately not stubbed. The plan + timestamp table are exactly what a
real encoder/muxer consumes.
