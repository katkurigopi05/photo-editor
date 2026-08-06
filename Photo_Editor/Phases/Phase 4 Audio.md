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

## Fades, EQ and compression (2026-08-05)

The per-clip effects chain the phase specified is now built: `audio.fade`,
`audio.eq` and `audio.compressor` are ordinary [[Data Model/EffectInstance]]
entries on the clip, so they are validated, undoable and replayable like any
visual effect. Overlapping two clips on one audio track crossfades them at equal
power. Live monitoring and the export mixdown share one envelope implementation
(`packages/playback-controller/src/audio-envelope.ts`), so what is heard is what
is written. See `docs/phases/audio-polish.md`.
