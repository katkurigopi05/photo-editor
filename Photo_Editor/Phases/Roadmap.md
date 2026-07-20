---
tags: [phase, moc]
---

# Build Roadmap

One deterministic core, two shells (desktop + web). Each phase is its own
contract with the same rigor as the Foundation; phases are not built all at once.

| Phase | Focus | Status |
| ----- | ----- | ------ |
| [[Phases/Phase 0 Foundation\|0 — Foundation]] | data model, command engine, undo/redo/replay | ✅ built |
| [[Phases/Phase 1 Media Decoding\|1 — Media Decoding]] | decode source media to pixels/samples | 🟡 image decode built — video/audio decode NOT done |
| [[Phases/Phase 2 Effects\|2 — Effects]] | render + effect stack | 🟡 effects apply in-browser; `crates/render-engine` compositing crate NOT built |
| [[Phases/Phase 3 Playback\|3 — Playback & Scrubbing]] | transport, frame-accurate seek | 🟡 transport core built |
| [[Phases/Phase 4 Audio\|4 — Audio Engine]] | mixing, waveform | 🟡 DSP core + state built, no UI wiring |
| [[Phases/Phase 5 Editing UI\|5 — Editing UI]] | timeline, viewer, inspector | 🟢 ahead of plan — raster toolset, AI bg removal, video crop, theming all shipped |
| [[Phases/Phase 6 Export\|6 — Export]] | encode + mux | ✅ complete — real image + video export (WebCodecs + mp4-muxer), preset picker (resolution/quality), live progress bar, capability check |

**Suggested order:** 0 → 1 → 2 → 3 → 5 → 4 → 6.

**Policy (2026-07-20):** Phase 5 leapfrogged Phase 1/2. New Phase 5+/6 feature work is paused until Phase 1 (video/audio decode) and Phase 2 (`crates/render-engine`) are actually complete — not just UI-visible progress. See memory `phase-discipline-policy`.

**Update (2026-07-20):** re-targeted the backfill to close Phase 6 first instead — export was found to be 100% fake (a toast, no file), the single most user-visible gap, and unrelated to the disconnected Rust decode/render-engine work. Both photo (PNG) and video (H.264 + Opus MP4, effects and audio mixdown baked in, real WebCodecs encode + `mp4-muxer` mux) export are now real and live-verified. Phase 1 video/audio decode and Phase 2 `render-engine` remain paused/deferred.

AI features are no longer deferred — real client-side AI background removal (ONNX U²-Net) shipped in Phase 5. Still deferred: auth, cloud sync, collaboration, a real backend (see Phase 7).

Every phase inherits the [[Rules/Non-negotiables]] and never bypasses the
[[Concepts/Command Engine]].
