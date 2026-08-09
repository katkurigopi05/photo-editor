# Blend modes

Until now every clip composited with normal alpha: one layer hid another, and a
stack of clips was only ever the topmost one. A blend mode is what turns that
stack into a composite — a texture on Multiply darkens, a light leak on Screen
only brightens, an Overlay grade lands *on* the picture rather than over it.

This was the largest photo gap on the competitive map, and it is small because
the canvas already knows how to do it. The work was in the model, not the maths.

## The list is the W3C list

`normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`,
`color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`, `hue`,
`saturation`, `color`, `luminosity` — the separable and non-separable modes of
the compositing spec, under exactly those names.

That is a deliberate refusal to invent vocabulary. The names are what
`globalCompositeOperation` accepts, so nothing is translated between the picker,
the command, the schema and the three render paths; and they are what every
other editor calls them, so nobody has to learn what this one means by Soft
Light.

The schema rejects the *other* `globalCompositeOperation` values —
`destination-out`, `copy`, `xor` and the rest. They are real canvas operations
but none of them describes how two pictures mix; accepting one would let a
project ask for a clip that erases what is beneath it.

## "normal" is an absence

`timeline.set_clip_blend_mode` with `normal` **deletes** the member rather than
storing it. Storing it would make a clip set back to normal and a clip never
touched two different projects that render identically, which is precisely what
canonical state exists to prevent — and it would break undo, which restores
bytes rather than appearance. The inverse carries `blendMode: null` for "there
was no member", distinct from `"normal"`.

The field is optional for the same reason `masks`, `markers` and `animations`
are: every project written before blend modes existed must still parse
byte-for-byte identically.

`compositeOperation()` maps `normal` to `source-over` rather than passing it
through. An unrecognised value is *silently ignored* by canvas, which would
leave the previous layer's operation in force — one clip's Multiply quietly
applying to the next.

## Where it applies

Inside the `save`/`restore` that `drawLayer` already had, so it cannot leak into
the next clip, and before the media is drawn. Preview, MP4 and GIF all run
`drawLayer`, so they inherit it together — the reason the e2e measures an
exported file rather than the preview canvas.

One exception: a transition's dip colour is painted `source-over` regardless. A
dip is an explicit colour laid *under* the clip; blending it would make the
"fade to black" of a Difference clip fade to something else.

Earlier tracks draw last, so the clip on the first track composites on top and
is the one whose blend mode has something to blend with. That ordering is
pre-existing, and it is what the e2e had to learn: the first draft set the mode
on the newly-added lower clip, measured no change, and would have passed against
a blend mode that did nothing at all.

## Tests

- `packages/project-schema/test/blend.test.ts` — the mode list, the canvas
  operations that are *not* blend modes, the `normal` → `source-over` mapping,
  and a clip with no mode parsing exactly as before.
- `packages/editor-state/test/blend.test.ts` — setting, clearing to nothing,
  undo restoring the previous mode rather than the default, undo restoring a
  clip that has no member at all, and byte-exact replay.
- `apps/web/e2e/blend-modes.spec.ts` — Multiply darkening and Screen brightening
  a real composite, returning to Normal leaving no trace, and the exported still
  carrying the blend.

The assertions are the definitions rather than tuned thresholds: multiply can
only darken and screen can only brighten, so each must land on its own side of
the unblended composite. Verified by neutralising the one line that sets the
operation — all three fail.

## Not built

- No blend mode on an *effect*, only on a clip. Photoshop has both.
- No opacity control separate from `transform.opacity`, which is what a blend
  mode is usually paired with; the existing effect covers it, but it is in a
  different part of the Inspector.
- Adjustment layers, which are the other half of this step: a clip that carries
  only effects and applies them to everything beneath it. Next.
