# Masks as project state

The Lightroom reference note ranks masking first by a wide margin, because it
turns every adjustment that already exists into a *local* adjustment. The mask
generators shipped earlier as raster code; this makes a mask something a user
can author, store, undo and export. Added 2026-08-06.

## The requirement, taken literally

> a mask is **not** a property of an adjustment; it is a first-class object an
> adjustment *references* … a brush stroke is a list of points plus a radius,
> not a baked bitmap.

So:

- A clip carries `masks: ClipMask[]` (optional, so pre-mask projects parse
  byte-identically). Each mask is `{ id, name?, contributions[] }`.
- An effect carries an optional `maskId`. One mask can drive several effects,
  and an effect moves between regions without being rebuilt.
- A contribution is geometry — linear, radial, brush, luminance range, colour
  range — plus a compose mode (add / subtract / intersect). No pixels are ever
  stored.

Coordinates are normalized 0…1 against the frame, matching
`transform.position_x` and the crop rectangle. `apps/web/src/mask-raster.ts` is
the single place they meet a pixel size, and it scales coordinates by
`size - 1` so that 1.0 lands on the last pixel rather than one past it.

## Commands

| Command | Inverse |
| --- | --- |
| `timeline.add_mask` | `internal.set_clip_masks` |
| `timeline.update_mask` | `internal.set_clip_masks` |
| `timeline.remove_mask` | `internal.set_clip_masks` |
| `timeline.set_effect_mask` | `internal.set_effect_mask` |

Every mask inverse restores the clip's **whole** mask list. The list is small
geometry, and carrying it entire buys exact undo — including the difference
between "no masks" and "an empty list", which canonical JSON treats as two
different projects — without a reconstruction rule per command.

Two referential rules the reducer enforces:

- `set_effect_mask` refuses a `maskId` the clip does not have. A dangling
  reference renders as "no mask", so the adjustment would silently go global.
- `remove_mask` refuses (`MASK_IN_USE`) while any effect references the mask.
  Detach first; the UI's Mask control has a "Whole frame" entry for exactly
  that.

## Rendering

Confinement happens in `blendThroughMask`, not inside each adjustment: the
effect is computed globally and blended back over the original by the mask's
coverage. That is what lets *every* effect be masked, including the grading and
painterly passes that take no mask argument, and it makes them all feather
identically.

Each referenced mask is rasterized once per frame, however many effects point at
it — turning geometry into coverage is the expensive half and does not depend on
which adjustment is asking. The cache key includes only the masks actually
referenced, so editing an unused mask does not invalidate a render.

### The CSS-filter problem

Brightness, contrast, saturation, exposure, hue rotate, greyscale, sepia, invert
and blur were drawn through the canvas filter string, which applies to the whole
layer and knows nothing about regions — so masking them did nothing at all. The
first version of the e2e test hid this: it masked Exposure, measured no change,
and the assertion it happened to make was satisfied anyway.

Masked instances of those effects are now rerouted through the pixel pass, where
a mask means something; unmasked instances keep the cheaper filter path. The
guard against applying an effect twice is one predicate, `runsAsPixels`, used by
both the pixel pass and the filter-string builder.

## Tests

- `packages/project-schema/test/masks.test.ts` — geometry validation,
  normalized bounds, unique ids, optionality on the clip, `maskId` on effects.
- `packages/editor-state/test/masks.test.ts` — the four commands, both
  referential refusals, byte-exact undo (including undo back to *no* masks
  field) and replay.
- `apps/web/test/mask-raster.test.ts` — resolution independence: the same mask
  covers the same fraction of a 40px and a 400px frame.
- `apps/web/e2e/masks.spec.ts` — a masked Exposure changes the covered region
  and not the rest, the region survives GIF export at another resolution, and
  deleting a mask in use is refused until the effect is detached.

The export assertion compares a masked export against an unmasked one rather
than comparing left against right: the fixture's own brightness varies
horizontally, so "inside is brighter than outside" would have been true of the
unmasked frame too. Both flaws are recorded here because the first versions of
these tests passed while proving nothing.

## Still open

Brush masks can be stored, rasterized and edited for size and feather, but there
is no painting interaction yet — a stroke has to arrive from a command. AI masks
(Subject / Sky / Background) are reachable via `bg-segmentation`: they would be
a contribution kind whose geometry is a cached segmentation rather than a shape.
