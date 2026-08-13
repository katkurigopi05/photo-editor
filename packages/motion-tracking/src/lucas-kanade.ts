import {
  buildPyramid,
  insideFrame,
  sampleBilinear,
  DEFAULT_LEVELS,
} from "./pyramid.js";
import type { FlowFrame, TrackPoint, TrackResult } from "./types.js";

/**
 * Pyramidal Lucas-Kanade: following one point from one frame to the next.
 *
 * The idea in one line: assume a small patch moves as a block, and that the
 * brightness of a moving pixel does not change. Then the displacement `d` that
 * best explains the two frames satisfies `G d = b`, where `G` is built from the
 * patch's own spatial gradients and `b` from the difference between the frames.
 * Solve, step, repeat.
 *
 * That linearisation is only valid for motion of about a pixel, so it is run
 * from the coarsest pyramid level down, each level's answer doubling into the
 * next level's starting guess. A 16-pixel motion is one pixel at level four.
 */

/**
 * Half-width of the patch. 15×15 overall.
 *
 * Bigger is steadier and blurs across motion boundaries; smaller follows detail
 * and loses its grip on smooth regions. This started at 21×21, which is the
 * textbook figure, and had to come down: the window must sit *inside* the
 * coarsest pyramid level, and a 21×21 window on a 25×20 level is almost
 * entirely clamped edge. That produced confidently wrong answers for motion
 * beyond about 8px — see `MIN_LEVEL_SIZE`, which is the other half of the same
 * constraint.
 */
const WINDOW_RADIUS = 7;

/** Stop iterating once a step moves the answer less than this many pixels. */
const CONVERGED_PX = 0.01;

/**
 * Cap per level. Also the guard against an occlusion making the steps oscillate
 * rather than settle.
 *
 * **30 because 12 was measured to be too few**, not as a round number. At the
 * coarsest level the solve may start several pixels from the answer and each
 * iteration is one Newton step; with 12 the tracker recovered 20,16 and 24,8
 * correctly but converged to a local minimum on 24,16 — a narrow, silent
 * failure that looked like a working tracker everywhere else.
 */
const MAX_ITERATIONS = 30;

/**
 * Below this, the patch has no structure worth tracking.
 *
 * The smaller eigenvalue of the gradient matrix, averaged over the window, in
 * units of (intensity per pixel)². **Measured**: flat regions give exactly 0,
 * and the broadband test texture gives 107 at full resolution and 210–280 at
 * coarser levels. 1 sits two orders of magnitude below real texture and clear
 * of the floor. `lucas-kanade.test.ts` asserts both ends so it cannot drift
 * into either failure.
 */
const MIN_EIGENVALUE = 1;

/**
 * Confidence saturates here: above it the patch is unambiguous and more texture
 * does not make the answer better.
 *
 * Measured rather than picked. The test texture reads 107–287 depending on
 * level, so 150 puts ordinary trackable detail around 0.7 — clearly good,
 * without pinning everything to 1 and throwing away the distinction the number
 * exists to make.
 */
const CONFIDENCE_SCALE = 150;

/**
 * Largest displacement this can be trusted to find, in pixels at full
 * resolution.
 *
 * Not a tuning knob — a property of the method. Each level can walk about a
 * window radius, and there are `levels` of them, so the reach is roughly
 * `WINDOW_RADIUS × 2^(levels-1)`. Measured on the test pattern: 24px is
 * recovered exactly and 40px converges to a local minimum and reports it
 * confidently. Documented here because a caller asking for more will get a
 * plausible wrong number rather than a failure.
 */
export const APPROX_MAX_DISPLACEMENT_PX = WINDOW_RADIUS * 4;

/** The 2×2 gradient matrix of a patch, and its own quality measure. */
interface StructureTensor {
  gxx: number;
  gxy: number;
  gyy: number;
  /** Smaller eigenvalue: how strongly the *weaker* of the two directions is
   * constrained. The larger one being big only means there is an edge, and an
   * edge alone cannot fix motion along itself — the aperture problem. */
  minEigenvalue: number;
}

/**
 * Spatial gradients over the window in `frame`, centred on (cx, cy).
 *
 * Central differences on bilinearly-sampled positions, so this works at
 * fractional centres and not only on whole pixels.
 */
function structureTensor(
  frame: FlowFrame,
  cx: number,
  cy: number,
): { tensor: StructureTensor; ix: number[]; iy: number[]; ref: number[] } {
  const ix: number[] = [];
  const iy: number[] = [];
  const ref: number[] = [];
  let gxx = 0;
  let gxy = 0;
  let gyy = 0;

  for (let wy = -WINDOW_RADIUS; wy <= WINDOW_RADIUS; wy += 1) {
    for (let wx = -WINDOW_RADIUS; wx <= WINDOW_RADIUS; wx += 1) {
      const x = cx + wx;
      const y = cy + wy;
      const dx =
        (sampleBilinear(frame, x + 1, y) - sampleBilinear(frame, x - 1, y)) / 2;
      const dy =
        (sampleBilinear(frame, x, y + 1) - sampleBilinear(frame, x, y - 1)) / 2;
      ix.push(dx);
      iy.push(dy);
      ref.push(sampleBilinear(frame, x, y));
      gxx += dx * dx;
      gxy += dx * dy;
      gyy += dy * dy;
    }
  }

  const count = ix.length;
  // Averaged so the threshold does not depend on the window size.
  const axx = gxx / count;
  const axy = gxy / count;
  const ayy = gyy / count;
  const trace = axx + ayy;
  const diff = Math.sqrt((axx - ayy) ** 2 + 4 * axy * axy);
  return {
    tensor: {
      gxx,
      gxy,
      gyy,
      minEigenvalue: Math.max(0, (trace - diff) / 2),
    },
    ix,
    iy,
    ref,
  };
}

/** Solve one level, returning the refined displacement or null if the patch is
 * degenerate. `guess` and the result are both in this level's pixels. */
function solveLevel(
  from: FlowFrame,
  to: FlowFrame,
  cx: number,
  cy: number,
  guess: TrackPoint,
): { displacement: TrackPoint; minEigenvalue: number } | null {
  const { tensor, ix, iy, ref } = structureTensor(from, cx, cy);
  const det = tensor.gxx * tensor.gyy - tensor.gxy * tensor.gxy;
  if (tensor.minEigenvalue < MIN_EIGENVALUE || det === 0) {
    return { displacement: guess, minEigenvalue: tensor.minEigenvalue };
  }

  let dx = guess.x;
  let dy = guess.y;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    let bx = 0;
    let by = 0;
    let i = 0;
    for (let wy = -WINDOW_RADIUS; wy <= WINDOW_RADIUS; wy += 1) {
      for (let wx = -WINDOW_RADIUS; wx <= WINDOW_RADIUS; wx += 1) {
        // The residual: how much brighter the source patch is than the place
        // the current guess points at. Zero everywhere means d is correct.
        const diff = ref[i]! - sampleBilinear(to, cx + wx + dx, cy + wy + dy);
        bx += diff * ix[i]!;
        by += diff * iy[i]!;
        i += 1;
      }
    }

    // Cramer's rule on the 2×2 system.
    const stepX = (tensor.gyy * bx - tensor.gxy * by) / det;
    const stepY = (tensor.gxx * by - tensor.gxy * bx) / det;
    if (!Number.isFinite(stepX) || !Number.isFinite(stepY)) return null;

    dx += stepX;
    dy += stepY;
    if (Math.abs(stepX) < CONVERGED_PX && Math.abs(stepY) < CONVERGED_PX) break;
  }

  return {
    displacement: { x: dx, y: dy },
    minEigenvalue: tensor.minEigenvalue,
  };
}

/**
 * Follow `at` from `from` to `to`.
 *
 * Coarse to fine: each level starts from twice the level above's answer, so
 * large motion is resolved where it is small and then refined where it is
 * precise.
 */
export function trackPoint(
  from: FlowFrame,
  to: FlowFrame,
  at: TrackPoint,
  levels: number = DEFAULT_LEVELS,
): TrackResult {
  const lost = (point: TrackPoint): TrackResult => ({
    point,
    confidence: 0,
    lost: true,
  });

  if (
    from.width !== to.width ||
    from.height !== to.height ||
    from.luma.length !== from.width * from.height
  ) {
    return lost(at);
  }
  // A window that hangs off the edge is mostly clamped border, and clamped
  // border is a strong flat region the solve will happily lock onto. Refusing
  // is honest; measuring fiction is not.
  if (!insideFrame(from, at.x, at.y, WINDOW_RADIUS)) return lost(at);

  const fromPyramid = buildPyramid(from, levels);
  const toPyramid = buildPyramid(to, levels);
  const depth = Math.min(fromPyramid.length, toPyramid.length);

  let displacement: TrackPoint = { x: 0, y: 0 };
  let minEigenvalue = 0;

  for (let level = depth - 1; level >= 0; level -= 1) {
    const scale = 1 / 2 ** level;
    const cx = at.x * scale;
    const cy = at.y * scale;
    const solved = solveLevel(
      fromPyramid[level]!,
      toPyramid[level]!,
      cx,
      cy,
      displacement,
    );
    if (solved === null) return lost(at);
    displacement = solved.displacement;
    // The finest level is the one whose structure decides trustworthiness: the
    // coarse levels have been blurred and would flatter a featureless patch.
    minEigenvalue = solved.minEigenvalue;
    // Carry down: one pixel here is two at the next level.
    if (level > 0) {
      displacement = { x: displacement.x * 2, y: displacement.y * 2 };
    }
  }

  const point = { x: at.x + displacement.x, y: at.y + displacement.y };

  if (minEigenvalue < MIN_EIGENVALUE) return lost(point);
  // Off the edge is lost, not merely uncertain — there is nothing there to have
  // followed, and a clamped sample would report a confident wrong answer.
  if (!insideFrame(to, point.x, point.y, 1)) return lost(point);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return lost(at);

  return {
    point,
    confidence: Math.min(1, minEigenvalue / CONFIDENCE_SCALE),
    lost: false,
  };
}
