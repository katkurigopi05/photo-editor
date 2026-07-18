---
tags: [phase]
---

# Phase 2 — Effects 🟡

The GPU render/compositing engine is future work; its **project-state layer** is
built now — deterministic and testable without a GPU.

**Built:** [[Data Model/EffectInstance]] on every [[Data Model/TimelineClip|clip]],
plus commands `timeline.add_effect`, `timeline.update_effect_params`,
`timeline.remove_effect`, `timeline.reorder_effects` — all through the
[[Concepts/Command Engine]], each with an inverse for [[Concepts/Undo Redo Replay]].

**Remaining:** the `wgpu` compositor, effects rendering graph, color management,
and frame cache (need pixel-hash fixtures) — not stubbed.

The effect state model is the stable seam the renderer will read from. See
[[Rules/Non-negotiables]] (effect params are Zod-validated, JSON-serializable,
replayable; no GPU handles in state).
