---
tags: [concept, reference, scope]
---

# Lightroom Feature Reference

[Adobe Lightroom](https://lightroom.adobe.com/) is the feature reference for this
project's photo side. This note records what it offers, what we take, and — just
as importantly — what we deliberately drop because of [[Rules/Local Only]].

> [!warning] Reference, not a spec
> Lightroom is a cloud subscription product. Roughly a third of its surface
> exists to serve sync, sharing, and account management. Take the *editing*
> model; leave the *service* model.

## Adopt — editing model

The core idea we already share: **edits are instructions over an untouched
original**, replayable and reversible. That is [[Rules/Non-negotiables]] #1 and
the [[Concepts/Command Engine]]. Lightroom's panels map onto our effects layer.

| Panel | Controls | Requirement for us |
|---|---|---|
| **Light** | Exposure, Contrast, Highlights, Shadows, Whites, Blacks, Tone Curve (RGB + per-channel) | Per-channel curve already exists in the Python track; the TS track needs the curve as an [[Data Model/EffectInstance]] with a serializable control-point list |
| **Color** | White Balance (Temp/Tint), Vibrance, Saturation, Color Mixer (HSL per band), Color Grading (shadow/mid/highlight wheels) | HSL and color grading are the two biggest missing pieces — both need an 8-band and a 3-way model respectively |
| **Effects** | Texture, Clarity, Dehaze, Vignette, Grain | Vignette exists; Clarity/Texture are local-contrast at different radii; Dehaze needs a haze estimate |
| **Detail** | Sharpening (amount/radius/detail/masking), Noise Reduction (luminance + color) | Unsharp mask exists; NR needs luminance/chroma split |
| **Optics** | Lens profile correction, chromatic aberration, defringe | Needs a lens-profile database — low priority for personal use |
| **Geometry** | Crop, straighten, rotate, perspective/Upright | Crop/straighten exist; perspective transform is missing |

## Adopt — masking (the highest-value gap)

Lightroom's masking is what separates it from a slider box: **every adjustment
above can be applied to a region instead of the whole frame**, and masks compose.

- **Manual masks** — Brush, Linear Gradient, Radial Gradient
- **Range masks** — refine by Color, Luminance, or Depth
- **AI masks** — Subject, Sky, Background, Objects, People (with per-part
  selection: facial skin, body skin, hair, clothing, eyes, lips, teeth)
- **Composition** — masks combine with Add, Subtract, and Intersect

Requirement: a mask is **not** a property of an adjustment; it is a first-class
object an adjustment *references*. A mask is a stack of contributions, each with
a mode (`add` / `subtract` / `intersect`), rasterized to an alpha channel. This
must serialize into the project file and replay deterministically — a brush
stroke is a list of points plus a radius, not a baked bitmap.

Local-only note: AI masks are viable here (segmentation runs on-device, as
[[Packages/bg-segmentation]] already proves). Subject/Sky/Background are
reachable; per-part People masking needs a face-parsing model.

## Adopt — library, scaled down

| Lightroom | Ours |
|---|---|
| Albums, folders | Local folders + albums in a [[Concepts/Local Catalog]] |
| Ratings (1–5), flags (pick/reject), color labels | All three — they cost little and drive culling |
| Keywords / tags | Yes, stored locally |
| Search + filter (by metadata, camera, lens, date) | Yes, over the local catalog index |
| EXIF display | Yes, read from the file |
| Assisted Culling (AI picks sharp/eyes-open) | Optional later; needs a local quality model |

## Drop — the service layer

Excluded by [[Rules/Local Only]], and listed here so nobody re-proposes them:

| Lightroom feature | Why we drop it |
|---|---|
| Cloud storage & sync across devices | No cloud. Catalog is local. |
| Web and mobile companion apps | Single machine, single user. |
| Sharing, web galleries, invite-to-edit, comments | No multi-user concerns. |
| Adobe account / subscription / entitlement checks | No identity to model. |
| **Generative Remove (Firefly)** | Cloud generative service. The local substitute is classical inpainting — already shipped in the Python track as `RemoveObject` (OpenCV Telea/NS) — plus optionally a local diffusion model later. |
| Adobe Stock / marketplace integration | Out of scope. |
| Telemetry & usage analytics | Prohibited. |

The pattern: where Lightroom's feature depends on *Adobe's servers*, we either
find the on-device equivalent or drop the feature. We never add a hosted
dependency to match a checkbox.

## Priority order

Derived from the gap between the tables above and what exists today:

1. **Masking as a first-class object** — unlocks every existing adjustment as a
   local adjustment. Highest leverage by a wide margin.
2. **HSL / Color Mixer** — the most-reached-for Lightroom panel we lack.
3. **Local catalog** — ratings, flags, keywords, search. Turns an editor into a
   workflow. See [[Concepts/Local Catalog]].
4. **Color Grading** (3-way wheels) and **Dehaze / Texture**.
5. **Optics and perspective** — real, but least missed on personal libraries.

Related: [[Rules/Local Only]], [[Concepts/Command Engine]],
[[Data Model/EffectInstance]].

## Progress (2026-08-06)

Priorities 2 and 4 are built, and priority 1 is half built:

- **Masking** — the generators exist (`linearGradientMask`,
  `radialGradientMask`, `brushStrokeMask`, `luminanceRangeMask`,
  `colorRangeMask`) and compose through `composeMasks`. What remains is making a
  mask *project state*: a schema, commands, and UI so it can be authored,
  stored and replayed. Until then masks are reachable from code only.
- **Colour Mixer, Colour Grading, Presence (Clarity/Texture/Dehaze), Noise
  Reduction** — built, and wired into the app as `EffectInstance` types, so they
  render in the preview and bake into every export.

Still open: AI masks, per-channel tone curve with control points,
[[Concepts/Local Catalog]], optics and perspective. See
`docs/phases/lightroom-panels.md`.

## Masking is now project state (2026-08-06)

Priority 1 is complete for everything but brush painting: a clip carries masks,
an effect references one by id, and both are ordinary validated commands with
exact inverses. Contributions are linear/radial/brush/luminance-range/colour-
range with add, subtract and intersect, stored as normalized geometry so a
region covers the same part of the picture at any output size.

Masking applies to *every* visual effect, including the ones drawn through the
canvas filter string — a masked instance is rerouted through the pixel pass.
Remaining: a brush painting interaction, and AI masks as a contribution kind
backed by [[Packages/bg-segmentation]]. See `docs/phases/masks.md`.
