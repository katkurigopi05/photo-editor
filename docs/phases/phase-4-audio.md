# Phase 4 — Audio Engine (DSP core + state, built)

Live monitoring/export mixdown needs decoded audio (Phase 1) at runtime. The
**deterministic DSP core** and the **per-clip audio state layer** are built now,
testable without any real media.

## DSP core (`crates/audio-engine`)

Pure functions over `f32` sample buffers — no decode, clock, randomness, or I/O
(the Foundation determinism contract):

- `db_to_gain(db)` — decibel → linear amplitude (0 dB = unity).
- `pan_gains(pan)` — constant-power pan (center = −3 dB per channel).
- `mix_stereo(sources, frames)` — sample-accurate mix of overlapping mono clips
  (gain + pan) into interleaved stereo; overlapping clips sum; reproducible.
- `resample_linear(input, src, dst)` — linear resample to a project rate.
- `waveform(input, bucket_size)` — peak/RMS buckets for display.

Tested: known-dB gain, constant-power pan, mix reproducibility and clip-boundary
placement, resample length/identity, waveform peak/RMS.

## State layer (`editor-state`)

`TimelineClip` gains `audioGainDb` (default 0, range [-60, 12]) and `audioPan`
(default 0, range [-1, 1]). Two commands go through the command engine with
inverses:

| Command                        | Inverse                          |
| ------------------------------ | -------------------------------- |
| `timeline.set_clip_audio_gain` | `internal.set_clip_audio_gain`   |
| `timeline.set_clip_audio_pan`  | `internal.set_clip_audio_pan`    |

Values are Zod-validated at the boundary; each command has a well-defined inverse
so undo/redo and replay restore exact prior audio state. No audio command alters
video timing.

## Not built (rest of Phase 4)

Real resampling of decoded sources, per-clip EQ/compressor effect chains, live
monitor vs. export routing, and waveform caching against real audio — all need
Phase 1 decode and are not stubbed. The DSP core is the seam they use.
