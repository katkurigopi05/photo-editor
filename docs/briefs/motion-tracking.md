# Brief: `@director/motion-tracking` (map steps A2 + A3)

Work brief for a **parallel agent**. Another stream is working on GPU shaders in
`apps/web/` at the same time.

## The one hard rule

**Do not touch any file outside `packages/motion-tracking/`.**

Specifically: not `apps/web/src/main.ts`, not `index.html`, not `index.css`, not
any other package. The other stream owns those, and the two branches must share
no file. Wiring this package to the UI is a separate commit by the other stream
once this lands.

`pnpm-workspace.yaml` already globs `packages/*`, so a new directory there is
picked up with no edit. There is genuinely nothing shared to touch.

## What this is for

Project Director is a local-first, deterministic photo/video editor. Two map
items are blocked on the same missing capability:

- **A2 · Motion tracking** — follow a point across frames, so an effect or mask
  can ride a moving subject.
- **A3 · Stabilisation** — measure how the whole frame moved, so it can be
  cancelled out.

Both need optical flow. This package is that, and nothing else.

## Deliverable

A new pnpm workspace package, shaped like `packages/canonical-json/`:

```
packages/motion-tracking/
├── package.json      # copy canonical-json's, rename to @director/motion-tracking
├── tsconfig.json     # copy canonical-json's
├── src/
│   ├── index.ts      # barrel — exports exactly the contract below
│   ├── pyramid.ts    # image pyramid construction
│   ├── lucas-kanade.ts
│   └── stabilise.ts
└── test/
    ├── pyramid.test.ts
    ├── lucas-kanade.test.ts
    └── stabilise.test.ts
```

**Pure TypeScript. No DOM, no canvas, no WebGL, no new dependencies.** The unit
suite runs under Node (vitest), like `raster-tools` does. If you find yourself
wanting `document`, the design is wrong — take `Uint8ClampedArray` instead.

## The contract

This is agreed with the other stream. Export exactly this from `src/index.ts`.
If you need to change a signature, that is fine — but say so explicitly in the
PR description, because the wiring commit is written against it.

```ts
/** A single-channel frame. Luma only: flow works on brightness, and carrying
 * three channels would triple the work for no gain. */
export interface FlowFrame {
  width: number;
  height: number;
  /** length === width * height */
  luma: Uint8ClampedArray;
}

export interface TrackPoint {
  x: number;
  y: number;
}

export interface TrackResult {
  /** Where the point moved to. Sub-pixel; do not round. */
  point: TrackPoint;
  /** 0..1. How much to trust `point`. */
  confidence: number;
  /** True when tracking failed — occluded, left the frame, or a flat region
   * with no structure to lock onto. `point` is meaningless when this is set. */
  lost: boolean;
}

/** Follow one point from `from` to `to`. */
export function trackPoint(
  from: FlowFrame,
  to: FlowFrame,
  at: TrackPoint,
): TrackResult;

/** The rigid transform that best maps `from` onto `to` — what stabilisation
 * must undo. Angles in radians, scale where 1 is unchanged. */
export interface RigidTransform {
  dx: number;
  dy: number;
  rotationRad: number;
  scale: number;
  confidence: number;
}

export function solveStabilisation(
  from: FlowFrame,
  to: FlowFrame,
): RigidTransform;

/** Convert RGBA (the format the rest of the app uses) to a FlowFrame. */
export function toFlowFrame(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): FlowFrame;
```

## Algorithm

Pyramidal Lucas-Kanade. Plain LK only handles motion of a pixel or two; a
pyramid solves coarse-to-fine so large motion works.

1. **Pyramid** — successive half-resolution levels, each a 2×2 box-filtered
   reduction of the one below. 4 levels is a reasonable default; stop before any
   dimension drops below ~16px.
2. **Per level, coarsest first** — solve the 2×2 LK system over a window
   (21×21 is a good default) using spatial gradients `Ix`, `Iy` and the temporal
   difference `It`. Iterate to convergence (~10 iterations or displacement
   < 0.01px).
3. **Propagate** the estimate down: `guess *= 2` at each finer level.
4. **Bilinear sampling** for sub-pixel window reads — nearest-neighbour makes
   the whole thing jitter and is the most likely cause of a "working but shaky"
   result.

**Confidence and `lost`** are not decoration. The smaller eigenvalue of the
2×2 structure tensor says whether the window has enough texture to be tracked
at all — a flat wall has none, and LK will return a confident-looking number
that is noise (the aperture problem). Report low confidence there, and set
`lost` when the point leaves the frame or the eigenvalue is below threshold.

For `solveStabilisation`, track a grid of points (e.g. 8×8 spread over the
frame), discard the lost ones, and fit a rigid transform to the survivors. Use a
robust fit — plain least squares is wrecked by a single moving object in an
otherwise still scene, which is the common case, not the edge case.

## Testing standard

This project has been repeatedly bitten by tests that pass while measuring
nothing. See `LESSONS.md` — read it before writing tests, especially
"three ways to test an instrument and measure nothing" and the entry about
tolerances.

Requirements:

- **Synthetic ground truth.** Generate a textured image, translate it by a known
  `(dx, dy)`, assert the tracker recovers it. Same for rotation and scale.
  Sub-pixel shifts (e.g. 3.7px) matter more than integer ones — integer-only
  tests pass with nearest-neighbour sampling and hide the jitter bug.
- **Mutation-check at least the sub-pixel path and the pyramid.** Break it on
  purpose, confirm the test fails, restore. State in the PR which mutations you
  tried and what happened. A test that has never been made to fail is not
  evidence.
- **Any tolerance must be measured, not argued.** Report the actual error you
  observe and set the bound near it. A bound picked by reasoning tends to land
  exactly at the size of the bug it was meant to catch — that happened in this
  repo last week and nearly shipped a broken shader.
- **Test the failure cases too**: a flat untextured region must come back
  `lost` or low-confidence, not confidently wrong. A point tracked off the edge
  of the frame must come back `lost`.
- 80%+ coverage.

## Gate — all must pass before the PR

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

Do **not** run `npx playwright test`. It needs port 5199 exclusively and the
other stream is using it. This package has no browser surface anyway.

## Style

Match the existing packages. Read `packages/raster-tools/src/lut3d.ts` first —
it is the closest analogue in shape and in comment style. Comments explain *why*
a choice was made, especially where a simpler-looking option is wrong. Files
under 400 lines.

Conventional commits (`feat:`, `test:`, `docs:`). Branch from `main` as
`feat/motion-tracking`. One PR.

## Out of scope

- Any UI. No buttons, no panels, no `main.ts`.
- Any command or schema change. Tracking data becomes project state later,
  through the command engine, in a separate piece of work.
- GPU. This is CPU TypeScript; the other stream owns all shader work.
- Rendering the stabilised result. This only *measures* the transform.
