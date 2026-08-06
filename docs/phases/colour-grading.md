# Colour grading

Four grading controls — White Balance, Levels, Tone Curve, Vibrance — added to
the Phase 2 effect stack on 2026-08-05. They are ordinary `EffectInstance`
entries, so they are validated, undoable, replayable and reorderable like every
other effect; nothing about the command engine changed to accommodate them.

## Why these four

They are the controls a photographer looks for by name, and none of them could
be faked with the CSS filters the renderer already used:

| Control | Params | What it does |
| ------- | ------ | ------------ |
| `color.white_balance` | `temperature`, `tint` | Per-channel gain: red/blue on temperature, green/magenta on tint. Gains rather than offsets, so black stays black. |
| `color.levels` | `blackPoint`, `whitePoint`, `gamma` | Clips below/above the window, stretches what survives across the full range, gamma bends midtones with both endpoints pinned. |
| `color.tone_curve` | `shadows`, `midtones`, `highlights` | Three Gaussian-weighted bands, each scaled by the headroom left in its direction of travel — so the curve stays monotonic and inside range. |
| `color.vibrance` | `amount` | Saturation weighted by `1 - saturation`, so muted colour gains most and vivid colour and skin barely move. A neutral gray is untouched at any amount. |

## Where the code lives

- `packages/raster-tools/src/grade.ts` — the four passes, pure functions over
  `RasterImage`. Three are built as 256-entry lookup tables, so cost is
  independent of parameter magnitude; vibrance needs the pixel's own saturation
  and is computed per pixel. Alpha is never touched.
- `packages/project-schema/src/effects.ts` — strict Zod params per type.
  `color.levels` refuses `blackPoint >= whitePoint` in the schema rather than
  defending against a degenerate window in the renderer.
- `apps/web/src/main.ts` — `grade()`, cached like `stylize()`, applied inside
  `drawLayer` so preview, still export, GIF and MP4 all share one code path.

## Ordering

Grading runs after background removal and **before** the painterly passes: the
photographer's order (correct the photograph, then paint over the corrected
result). Within the grade, the clip's own effect-stack order decides, so
reordering in the Inspector reorders the grade.

## Cache correctness

`stylize()` used to key its cache by asset URI. Once pixels can be graded before
they are stylized, that key is wrong — a re-grade would be served the painterly
render of the *ungraded* frame. `drawLayer` now builds a `sourceKey` describing
the pixels actually in hand (asset + background-removal params + grade
signature) and every downstream cache keys off that. The same bug existed for
background removal before grading was added.

## Tests

- `packages/raster-tools/test/grade.test.ts` — neutral parameters are exact
  no-ops, each control moves the channel it claims to, the tone curve stays
  monotonic and in range, alpha survives, results are deterministic.
- `packages/project-schema/test/grading-effects.test.ts` — range limits, the
  inverted-levels-window refusal, unknown params, non-finite numbers.
- `apps/web/e2e/grading.spec.ts` — drives the real inspector sliders and
  measures the painted canvas, then decodes an exported GIF to prove the grade
  reaches the file and not just the preview.
