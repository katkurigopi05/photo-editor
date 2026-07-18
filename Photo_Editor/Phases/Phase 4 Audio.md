---
tags: [phase]
---

# Phase 4 — Audio Engine 🟡

Sample-accurate mixing, gain/pan, resampling, and waveforms. The **DSP core** and
the **per-clip audio state** are built now; live/export mixdown of real decoded
audio is future work.

**Built:**
- [[Crates/audio-engine]] — pure DSP: gain (dB), constant-power pan,
  `mix_stereo`, `resample_linear`, `waveform`.
- State: [[Data Model/TimelineClip|audioGainDb / audioPan]] on every clip, with
  commands `timeline.set_clip_audio_gain` / `timeline.set_clip_audio_pan`
  through the [[Concepts/Command Engine]], each with an inverse for
  [[Concepts/Undo Redo Replay]]. No audio command alters video timing.

**Remaining:** resampling of decoded sources, EQ/compressor effect chains,
monitor vs. export routing, waveform caching against real audio — need Phase 1
decode, not stubbed.

See [[Phases/Roadmap]].
