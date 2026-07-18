---
tags: [crate, phase-4]
---

# audio-engine

Deterministic audio DSP primitives — the [[Phases/Phase 4 Audio|Phase 4]] core.
Pure `f32` functions, no decode/clock/randomness/I/O ([[Concepts/Determinism]]).

- `db_to_gain(db)` — decibel → linear amplitude (0 dB = unity).
- `pan_gains(pan)` — constant-power stereo pan (center = −3 dB/channel).
- `mix_stereo(sources, frames)` — sample-accurate mix of overlapping mono clips
  (gain + pan); overlapping clips sum; reproducible.
- `resample_linear(input, src, dst)` — linear resample to a project rate.
- `waveform(input, bucket_size)` — peak/RMS buckets for display.

Mixing is a pure function of its inputs. Consumes the per-clip audio state
([[Data Model/TimelineClip|audioGainDb / audioPan]]). Compiles native +
(later) WASM.
