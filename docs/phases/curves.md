# Control-point curves

Points you place yourself, on the composite or on any one channel. The
three-band Tone Curve could only push shadows, midtones and highlights as a
whole; this is the control every reference editor has and the Lightroom
reference note had listed as missing since it was written. Added 2026-08-11.

## Monotone cubic, and why not a plain spline

Between its points a curve needs a rule. The rule here is **monotone cubic
Hermite** (Fritsch–Carlson), chosen for the one property a tone curve must
have: *it may never go where its points do not send it.*

An ordinary cubic spline is smoother and wrong. It overshoots — a bright
control point makes the curve swing higher still just before reaching it — and
on a picture that reads as a halo above a highlight or a crushed band below a
shadow that nobody asked for. Fritsch–Carlson limits the tangents so every span
stays inside the box its endpoints define.

Two tests pin exactly this, because it is the whole reason for the algorithm:
one walks 200 samples across a curve whose points sit between 0.1 and 0.9 and
asserts nothing leaves that range; another walks 500 samples across a rising
curve and asserts it never dips, since a dip would darken a pixel brighter than
its neighbour and show up as a false edge.

Outside a curve's own range the nearest endpoint is **held, not extrapolated**.
A curve says nothing about what lies beyond its last point, and guessing there
is how a highlight ends up brighter than white.

## Anchored ends, strictly increasing x

The schema requires the first point at `x = 0`, the last at `x = 1`, and x
strictly increasing. Without the anchors a curve would say nothing about its
darkest and brightest input; without strict increase two points could share an x
and the value there would depend on which the evaluator happened to reach first.

`y` is free, so a curve may fall as well as rise — that is what an inversion is.

All four channels are always present. An absent curve and an identity curve
render the same and store differently, which is precisely what canonical state
exists to prevent.

## Four LUTs composed into three

Sampling the spline per channel per pixel would compute the same 256 answers
millions of times, so each curve becomes a 256-entry byte table. The per-channel
tables are then composed *through* the composite table before the pixel loop, so
a pixel costs three lookups no matter how many curves are in play.

Per-channel first, then composite — the order Photoshop's Curves dialog implies:
the per-channel curves decide the colour, and the composite curve shapes the
tone of whatever colour resulted. Reversing it would let a composite contrast
boost undo the colour balance a per-channel curve had just set.

The LUT is built with `Uint8ClampedArray`, so a value pushed past white clamps
instead of wrapping. Wrapping is the classic curve bug: a blown highlight comes
back as black and a hole appears in the picture. A test asserts a
pinned-to-white and a pinned-to-black curve both stay there.

## The editor

A square canvas: drag a point to move it, click empty space to add one,
double-click or right-click one to remove it. Tabs pick RGB, R, G or B.

- **The two endpoints move vertically only.** The schema anchors them at x = 0
  and x = 1, and letting them slide inward would leave the curve undefined at
  the ends.
- **Inner points are held strictly between their neighbours**, because two
  points at one x is a curve with no defined value there.
- **Committed on release, not on every pointer move.** A drag is one edit; one
  command per mouse sample would bury the operation log and make Undo step back
  through a gesture pixel by pixel. An e2e asserts a single Undo undoes a whole
  drag.
- The identity diagonal is drawn faintly behind the curve, so a change reads as
  a departure from it rather than as an absolute shape.

## Two bugs the tests caught

**The effect could not be added at all.** Default params are built by walking
`spec.params`, and a curve has no scalar params — so the object was `{}`, which
its own schema rejects, so `add_effect` failed and *nothing appeared*, with no
visible reason. A spec can now supply a whole `defaults` object; the curve
supplies four identity curves. The e2e found this immediately because it asserts
the editor exists rather than assuming the click worked.

**The drag never reached the canvas.** The first version of the e2e read the
canvas box without scrolling: the Inspector scrolls, the editor sat at y = 2545,
and `page.mouse` works in viewport coordinates — so every drag went to empty
space outside the window and the picture was byte-identical afterwards. That was
a test bug rather than an app bug, and it is worth recording because a *slightly*
weaker assertion ("the picture changed") would have looked like an app bug for a
long time.

## Tests

- `packages/raster-tools/test/curves.test.ts` — identity, passing exactly
  through every control point, no overshoot, monotonicity, endpoint holding, and
  the LUT's identity and clamping behaviour.
- `apps/web/e2e/curves.spec.ts` — **direction**, not just change: dragging up
  brightens and dragging down darkens, which a curve wired in upside down would
  fail. Plus one Undo per drag, a per-channel curve doing something different
  from the composite, and Reset channel.

## Not built

- **Keyboard editing.** The canvas has an `application` role but points are
  mouse-only; arrow-key nudging of a selected point is the obvious next step.
- **A histogram behind the curve**, which is how Lightroom shows you where the
  tones you are moving actually live. The scopes already compute one.
- **Curve presets** (S-curve, film, faded), which would be `Looks` carrying a
  curve rather than anything new in the model.
- **Reading a curve from a LUT file** — that is step C3, and unchanged.
