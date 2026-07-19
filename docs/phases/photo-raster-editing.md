# Photo raster editing (Photo mode)

A full pixel-editing toolset for Photo mode, matching the tool set of a
reference open-source editor (Move, Crop, Transform, Brush, Eraser, Clone
Stamp, Lasso, Magic Wand, Sharpen, Smart Fill, Remove Background) — built as
**original code with original algorithms**, not copied. The reference project
is AGPLv3-licensed; this repository is MIT, and AGPL's copyleft is not
compatible with copying code into an MIT project. Nothing was ported; every
algorithm here was written from scratch against the well-known classical
technique it implements (documented per-function below).

## Architecture

- **`packages/raster-tools`** — pure, canvas-free pixel algorithms over a
  plain `{ width, height, data: Uint8ClampedArray }` buffer. No DOM
  dependency, so every algorithm is unit-tested directly (29 tests):
  - `stampBrush`, `cloneStamp` — soft-circle brush/eraser/clone stamping.
  - `polygonMask` (scanline fill), `floodFillMask` (BFS/global color-distance
    flood fill — the classic "magic wand"), `invertMask`, `featherMask`
    (separable box blur), `maskBounds`.
  - `applyMaskDelete`, `applyMaskFill` — selection actions.
  - `unsharpMask` — classic unsharp mask (`image + amount * (image - blur)`).
  - `diffusionFill` — **"Smart Fill"**: harmonic/Laplace diffusion inpainting
    (Gauss-Seidel relaxation toward the selection's boundary). This is the
    honest, classical stand-in for the reference app's AI diffusion-model
    "Inpaint" tool — no model, no network call, no bundled weights.
  - `colorKeyAlpha`, `cornerKeyColor` — the same deterministic color-key
    algorithm as the `fx.remove_background` effect (Phase 2), now also usable
    as a raster tool.
  - `cropImage`, `resizeImage` (bilinear), `rotateImage` (bilinear,
    bounding-box-correct), `shiftImage` — geometry ops.

- **`apps/web/src/raster.ts`** — `RasterSession`: DOM/canvas glue around a
  working `RasterImage` buffer, with a bounded (25-entry) local undo/redo
  stack. **Outside the deterministic project command engine**, exactly like
  playback and export state — individual brush strokes never enter the
  operation log.

- **`apps/web/src/main.ts`** (raster section) — the tool rail, per-tool right
  panel, and pointer-event wiring for all 11 tools, gated to
  `mode === "photo"` and an `image`-kind clip selected ("🖌 Edit Photo" entry
  point in the Inspector).

## Getting back into the deterministic engine

Raster edits are session-local until you hit **Apply**: the working buffer is
flattened to a PNG blob, hashed with real SHA-256, and registered as a brand
new `MediaAsset` via the real `asset.register` command — the same validated,
replayable path every other imported photo takes. It lands in the Media bin;
drag it onto the timeline like any other asset. **Discard** exits without
touching the project. Nothing here bypasses Zod validation or writes directly
to project state.

## Scope

Photo mode only, per the current requirement. Video clips do not show the
raster tool entry point. Sharpen and the geometry tools (crop/resize/rotate)
apply to the whole working buffer; selection-scoped tools (Delete, Fill,
Smart Fill) operate on the current Lasso/Wand selection.
