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

## Colour grading (2026-08-05)

White Balance, Levels, Tone Curve and Vibrance ship as ordinary
[[Data Model/EffectInstance]] entries — validated, undoable, reorderable. The
passes are pure functions in `packages/raster-tools/src/grade.ts`; the browser
renderer applies them inside the shared draw path, so a grade looks identical in
the preview and in every exported frame. Grading runs before the painterly
passes. See `docs/phases/colour-grading.md`.
