---
tags: [package]
---

# raster-tools

Pure, canvas-free pixel algorithms for [[Phases/Phase 5 Editing UI|Photo-mode
raster editing]]: brush/eraser/clone stamping, polygon + flood-fill (magic
wand) selection, feather/invert, unsharp mask, harmonic-diffusion **Smart
Fill** (classical, non-ML inpainting), color-key background removal, and
crop/resize/rotate/shift geometry. Operates on a plain
`{width, height, data: Uint8ClampedArray}` buffer — no DOM dependency, so
every algorithm is unit-tested directly (29 tests) without a browser canvas.

Original implementation. Shaped after (but sharing no code with) a
reference AGPLv3 editor's tool set — AGPL's copyleft is incompatible with
this MIT repo, so the tool *names* and *UX shape* were the only things
carried over; every algorithm was written from scratch.

Consumed by `apps/web/src/raster.ts` (`RasterSession`: canvas glue + bounded
local undo/redo, kept outside the [[Concepts/Command Engine]] like playback
and export state) and wired into `apps/web/src/main.ts`'s tool rail. "Apply"
flattens the working buffer and registers it as a real new
[[Data Model/MediaAsset]] via `asset.register` — the only path back into the
deterministic project.
