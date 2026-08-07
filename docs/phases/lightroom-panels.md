# Lightroom panels: Tone, Colour Mixer, Colour Grading, Presence, Detail

`Photo_Editor/Concepts/Lightroom Feature Reference.md` set a priority order for
closing the gap with Lightroom's editing model, and `packages/raster-tools/src/
adjust.ts` implemented the Light and Colour panels as pure, mask-aware raster
functions. This completes the list and connects it to the running app. Added
2026-08-06.

## What was already there, and what was missing

`adjust.ts` shipped exposure, contrast, highlights/shadows/whites/blacks,
temperature/tint, saturation, vibrance, the HSL Colour Mixer, and
`composeMasks`. Against the reference note's own priority order, four things
were missing:

| Reference priority | State before | Now |
| --- | --- | --- |
| 1. Masking as a first-class object | adjustments accepted a mask; **nothing produced one** beyond polygon/flood fill | linear + radial gradients, brush strokes, luminance and colour range masks |
| 2. Colour Mixer | done | unchanged |
| 4. Colour Grading (3-way) | missing | `colorGrading()` with shadow/midtone/highlight wheels, Balance and Blend |
| 4. Dehaze / Texture (+ Clarity) | missing | `clarity()`, `texture()`, `dehaze()` |
| Detail: noise reduction | missing | `noiseReduction()` split into luminance and colour |

And the structural gap: **none of it reached the app**. There were no effect
types, no controls, and no renderer path, so a user could not apply any of it.

## Masking

`packages/raster-tools/src/mask.ts` gained the generators. Two decisions worth
keeping:

- **Coverage bytes, not booleans.** Partial coverage is what makes a gradient
  blend rather than cut, and what lets a range mask say "mostly this colour".
  `composeMasks` already worked this way; the generators match it.
- **Parameters, not bitmaps.** Each generator is a pure function of its
  arguments, so a mask can be persisted as what produced it — a stroke is a
  list of points and a radius. That is the prerequisite for masks becoming
  project state that replays, which the reference note calls out explicitly.

A linear gradient snaps to its axis and clamps past both ends; a radial takes a
number or a point for an elliptical radius and can be inverted (the "everything
except the subject" case); a brush sweeps along the *segments* of a polyline,
because stamping each sampled point leaves a dotted line.

## Clarity vs Texture

Both are local-contrast controls, and the naive implementation — original minus
a blur — makes them the same control at two radii, with the *wider* radius
crunching grain harder. That is backwards: Clarity exists precisely so midtone
form can be shaped without touching grain.

So both are band-pass: `clarity` amplifies the band between a 1px and a 4px
blur, `texture` everything finer than 1px. On a fine checkerboard, texture bites
and clarity barely moves — which is the property the test pins.

## Dehaze

Not a local-contrast control at all. Haze compresses a scene into a narrow,
bright, low-saturation band, so clearing it measures the occupied luminance band
from the image itself (1% tails ignored, so one blown pixel cannot decide the
stretch) and stretches that band back across the range, with a matching
saturation move. A correctly exposed frame has nothing to stretch and is barely
touched.

## Noise reduction

Luminance and colour are separate because the eye is not: chroma is read at much
lower resolution, so colour noise can be smoothed hard while the same treatment
on luminance destroys the picture. The pass smooths brightness toward the
neighbourhood average by the luminance amount, and the chroma offsets by the
colour amount, independently. Strength widens the radius rather than only
weighting the blend — a fixed 1px radius at 100 is invisible on real grain.

## Wiring

Five new `EffectInstance` types, all running in the existing adjustment pass in
`drawLayer` (so preview, PNG, GIF and MP4 agree):

`light.tone`, `color.hsl_mixer`, `color.color_grading`, `fx.presence`,
`detail.noise_reduction`.

The Colour Mixer carries **one band per instance** rather than eight bands of
three sliders on a single effect: twenty-four controls on one panel is unusable,
and the effect stack already knows how to hold several instances of one type.
This needed a new `choice` param kind in the inspector.

`vibrance` existed in both `grade.ts` and `adjust.ts` after the merge. The
mask-aware version won; the grading effect scales its own −1…1 amount to
Lightroom's −100…100 at the single call site.

## Tests

- `packages/raster-tools/test/local-masks.test.ts` — gradient geometry,
  clamping, ellipses, swept strokes, range windows and feathering, plus the
  property the model rests on: an adjustment through a mask changes the covered
  pixels and leaves the rest alone, and blends proportionally where coverage is
  partial.
- `packages/raster-tools/test/detail.test.ts` — no-ops at zero, Clarity vs
  Texture scale separation, Dehaze's band stretch, colour-noise removal that
  leaves luminance structure intact, and the grading wheels' band separation.
- `apps/web/e2e/lightroom-panels.spec.ts` — each panel driven through the real
  inspector and measured on the painted canvas.

One measurement note recorded because it cost time: an adjusted clip is drawn
from an offscreen canvas and rescaled into the preview, and that rescale changes
neighbour differences by more than noise reduction does. The noise-reduction
assertion therefore measures the **exported** frame, at native size, where the
smoothing is the only variable.

## Still not done, from the same reference

- Masks as project state (schema, commands, UI) — the generators exist, but a
  mask cannot yet be authored or stored.
- AI masks (Subject/Sky/Background), which `bg-segmentation` makes reachable.
- Per-channel tone curve with serializable control points.
- Local catalog (ratings, flags, keywords, search).
- Optics and perspective.
