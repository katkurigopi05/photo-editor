---
tags: [phase, moc]
---

# Build Roadmap

One deterministic core, two shells (desktop + web). Each phase is its own
contract with the same rigor as the Foundation; phases are not built all at once.

| Phase | Focus | Status |
| ----- | ----- | ------ |
| [[Phases/Phase 0 Foundation\|0 — Foundation]] | data model, command engine, undo/redo/replay | ✅ built |
| [[Phases/Phase 1 Media Decoding\|1 — Media Decoding]] | decode source media to pixels/samples | 🟡 image decode built |
| [[Phases/Phase 2 Effects\|2 — Effects]] | render + effect stack | 🟡 state layer built |
| [[Phases/Phase 3 Playback\|3 — Playback & Scrubbing]] | transport, frame-accurate seek | 🟡 transport core built |
| 4 — Audio Engine | mixing, waveform | ⬜ future |
| 5 — Editing UI | timeline, viewer, inspector | ⬜ future |
| 6 — Export | encode + mux | ⬜ future |

**Suggested order:** 0 → 1 → 2 → 3 → 5 → 4 → 6.

Deferred entirely: AI features, auth, cloud sync, collaboration, a real backend.

Every phase inherits the [[Rules/Non-negotiables]] and never bypasses the
[[Concepts/Command Engine]].
