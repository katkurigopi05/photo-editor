import { trackPoint } from "./lucas-kanade.js";
import { insideFrame } from "./pyramid.js";
import type { FlowFrame, RigidTransform, TrackPoint } from "./types.js";

/**
 * Measuring how the whole frame moved — the half of stabilisation that has to
 * be right before anything can be undone.
 *
 * One point cannot tell translation from rotation, so a grid is tracked and a
 * single rigid transform fitted to whatever survives.
 */

/** Points per axis. 8×8 is 64 samples: enough that a moving subject is a
 * minority, few enough to stay cheap. */
const GRID = 8;

/** Fraction of the frame left clear at each edge, so windows are not mostly
 * clamped border. */
const INSET = 0.12;

/**
 * A displacement further than this many median-absolute-deviations from the
 * middle is treated as belonging to something else.
 *
 * 2.5 is the usual robust-statistics cut. It matters because the common case is
 * not noise — it is a person walking through an otherwise still shot, and plain
 * least squares would average their motion into the camera's.
 */
const OUTLIER_MADS = 2.5;

const IDENTITY: RigidTransform = {
  dx: 0,
  dy: 0,
  rotationRad: 0,
  scale: 1,
  confidence: 0,
};

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
};

/** Median absolute deviation — a spread that a few wild values cannot inflate,
 * unlike a standard deviation. */
const mad = (values: number[], centre: number): number =>
  median(values.map((v) => Math.abs(v - centre)));

/** The grid of start positions, inset from the edges. */
export function samplingGrid(frame: FlowFrame): TrackPoint[] {
  const points: TrackPoint[] = [];
  const x0 = frame.width * INSET;
  const y0 = frame.height * INSET;
  const spanX = frame.width * (1 - 2 * INSET);
  const spanY = frame.height * (1 - 2 * INSET);
  for (let row = 0; row < GRID; row += 1) {
    for (let col = 0; col < GRID; col += 1) {
      const x = x0 + (spanX * col) / (GRID - 1);
      const y = y0 + (spanY * row) / (GRID - 1);
      if (insideFrame(frame, x, y, 12)) points.push({ x, y });
    }
  }
  return points;
}

/**
 * The rigid transform (translation, rotation, uniform scale) taking `from` to
 * `to`.
 *
 * Fitted by the closed-form similarity solution over the surviving
 * correspondences — no iteration, no local minimum to fall into. Outliers are
 * removed first by their displacement, because a wrong correspondence pulls a
 * least-squares fit hard and there is no way to tell afterwards that it did.
 */
export function solveStabilisation(
  from: FlowFrame,
  to: FlowFrame,
): RigidTransform {
  if (from.width !== to.width || from.height !== to.height) return IDENTITY;

  const tracked: { a: TrackPoint; b: TrackPoint }[] = [];
  for (const start of samplingGrid(from)) {
    const result = trackPoint(from, to, start);
    if (result.lost) continue;
    tracked.push({ a: start, b: result.point });
  }
  // Three is the minimum for a similarity to be over-determined at all; below
  // that the "fit" is just the points themselves and means nothing.
  if (tracked.length < 3) return IDENTITY;

  const dxs = tracked.map((t) => t.b.x - t.a.x);
  const dys = tracked.map((t) => t.b.y - t.a.y);
  const mx = median(dxs);
  const my = median(dys);
  // A scale floor keeps a perfectly still shot — where every deviation is 0 —
  // from rejecting every point for deviating by more than zero.
  const sx = Math.max(0.5, mad(dxs, mx));
  const sy = Math.max(0.5, mad(dys, my));

  const kept = tracked.filter(
    (t, i) =>
      Math.abs(dxs[i]! - mx) <= OUTLIER_MADS * sx &&
      Math.abs(dys[i]! - my) <= OUTLIER_MADS * sy,
  );
  if (kept.length < 3) return IDENTITY;

  // Centroids: a similarity is a rotation and scale about the centroid, plus
  // the translation between centroids.
  let ax = 0;
  let ay = 0;
  let bx = 0;
  let by = 0;
  for (const t of kept) {
    ax += t.a.x;
    ay += t.a.y;
    bx += t.b.x;
    by += t.b.y;
  }
  ax /= kept.length;
  ay /= kept.length;
  bx /= kept.length;
  by /= kept.length;

  // Closed-form least-squares similarity. `dot` accumulates the aligned part
  // and `cross` the perpendicular part; their ratio is the rotation and their
  // magnitude over the source spread is the scale.
  let dot = 0;
  let cross = 0;
  let norm = 0;
  for (const t of kept) {
    const px = t.a.x - ax;
    const py = t.a.y - ay;
    const qx = t.b.x - bx;
    const qy = t.b.y - by;
    dot += px * qx + py * qy;
    cross += px * qy - py * qx;
    norm += px * px + py * py;
  }
  if (norm === 0) return IDENTITY;

  const rotationRad = Math.atan2(cross, dot);
  const scale = Math.hypot(dot, cross) / norm;

  // Translation is what is left once the rotation and scale about the origin
  // have been applied to the source centroid.
  const cos = Math.cos(rotationRad) * scale;
  const sin = Math.sin(rotationRad) * scale;
  const dx = bx - (ax * cos - ay * sin);
  const dy = by - (ax * sin + ay * cos);

  return {
    dx,
    dy,
    rotationRad,
    scale,
    // How much of the grid agreed. A transform fitted from a handful of
    // survivors is a guess, and the caller deserves to know which it has.
    confidence: kept.length / Math.max(1, tracked.length),
  };
}
