---
tags: [phase, moc]
---

# Build Roadmap

One deterministic core, two shells (desktop + web). Each phase is its own
contract with the same rigor as the Foundation; phases are not built all at once.

| Phase | Focus | Status |
| ----- | ----- | ------ |
| [[Phases/Phase 0 Foundation\|0 — Foundation]] | data model, command engine, undo/redo/replay | ✅ built |
| [[Phases/Phase 1 Media Decoding\|1 — Media Decoding]] | decode source media to pixels/samples | 🟢 product-complete — import probes real dimensions/duration + sha256 checksum, browser decodes image/video/audio. Native Rust `media-core` decoders deferred (unused by web app) |
| [[Phases/Phase 2 Effects\|2 — Effects]] | render + effect stack | 🟢 product-complete — effects render live in preview and bake into export. Native `crates/render-engine` wgpu compositor deferred (unused) |
| [[Phases/Phase 3 Playback\|3 — Playback & Scrubbing]] | transport, frame-accurate seek | 🟢 product-complete — transport core + live A/V sync (media plays in sync during preview) |
| [[Phases/Phase 4 Audio\|4 — Audio Engine]] | mixing, waveform | 🟢 product-complete — DSP core + state, live gain/pan monitoring during playback, timeline waveforms, export mixdown |
| [[Phases/Phase 5 Editing UI\|5 — Editing UI]] | timeline, viewer, inspector | 🟢 ahead of plan — raster toolset, AI bg removal, video crop, theming all shipped |
| [[Phases/Phase 6 Export\|6 — Export]] | encode + mux | ✅ complete — real image + video export (WebCodecs + mp4-muxer), preset picker (resolution/quality), live progress bar, capability check |

**Suggested order:** 0 → 1 → 2 → 3 → 5 → 4 → 6.

**Policy (2026-07-20):** the product-facing form of every phase is now built on the browser stack the app actually runs on. What remains explicitly deferred is the *native Rust engine* internals — `media-core` video/audio decoders, the `crates/render-engine` wgpu compositor, and a Rust A/V scheduler — none of which the shipped web app consumes (it uses the browser's own decode/render/audio). See memory `phase-discipline-policy`.

**Update (2026-07-20):** completed the product-facing gaps for phases 1–4 on the browser stack: live audio monitoring (hear the timeline, per-clip gain/pan) and A/V sync during playback, timeline waveforms, and confirmed import already probes + checksums for real. Phase 6 export was closed first (real WebCodecs + `mp4-muxer` MP4, effects + audio baked in). Native Rust decode/render-engine work remains deferred as above.

AI features are no longer deferred — real client-side AI background removal (ONNX U²-Net) shipped in Phase 5. Still deferred: auth, cloud sync, collaboration, a real backend (see Phase 7).

Every phase inherits the [[Rules/Non-negotiables]] and never bypasses the
[[Concepts/Command Engine]].
