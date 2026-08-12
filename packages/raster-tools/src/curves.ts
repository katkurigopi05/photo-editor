import type { RasterImage } from "./types.js";

/**
 * Control-point tone curves.
 *
 * A curve is a handful of points and a rule for the space between them. The
 * rule is **monotone cubic Hermite** (Fritsch–Carlson), chosen for the one
 * property a tone curve has to have: it may never go where its points do not
 * send it.
 *
 * An ordinary cubic spline is smoother and wrong. It overshoots between
 * points — a bright control point makes the curve swing higher still just
 * before it — and on a picture that reads as a halo above a highlight or a
 * crushed band below a shadow that nobody asked for. Fritsch–Carlson limits the
 * tangents so each span stays inside the box its endpoints define, which is
 * exactly the guarantee wanted here.
 */

export interface CurvePoint {
  x: number;
  y: number;
}

/** The curve that changes nothing. */
export const IDENTITY_CURVE: readonly CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Sample a curve at `x`, both in 0…1.
 *
 * Outside the curve's own range the nearest endpoint is held rather than
 * extrapolated: a curve says nothing about what lies beyond its last point, and
 * guessing there is how a highlight ends up brighter than white.
 */
export function curvePoint(points: readonly CurvePoint[], x: number): number {
  if (points.length === 0) return clamp01(x);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (points.length === 1) return clamp01(first.y);
  if (x <= first.x) return clamp01(first.y);
  if (x >= last.x) return clamp01(last.y);

  let i = 0;
  while (i < points.length - 2 && x > points[i + 1]!.x) i += 1;
  const p0 = points[i]!;
  const p1 = points[i + 1]!;
  const h = p1.x - p0.x;
  if (h <= 0) return clamp01(p1.y);

  // Secants, then Fritsch–Carlson tangents: the limiter is what keeps every
  // span inside its own endpoints.
  const tangents = monotoneTangents(points);
  const m0 = tangents[i]!;
  const m1 = tangents[i + 1]!;
  const t = (x - p0.x) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const y =
    (2 * t3 - 3 * t2 + 1) * p0.y +
    (t3 - 2 * t2 + t) * h * m0 +
    (-2 * t3 + 3 * t2) * p1.y +
    (t3 - t2) * h * m1;
  return clamp01(y);
}

/** Fritsch–Carlson tangents: secant slopes, then limited so no span overshoots. */
function monotoneTangents(points: readonly CurvePoint[]): number[] {
  const n = points.length;
  const secants: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const dx = points[i + 1]!.x - points[i]!.x;
    secants.push(dx === 0 ? 0 : (points[i + 1]!.y - points[i]!.y) / dx);
  }

  const tangents: number[] = new Array(n).fill(0);
  tangents[0] = secants[0] ?? 0;
  tangents[n - 1] = secants[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i += 1) {
    const a = secants[i - 1]!;
    const b = secants[i]!;
    // A sign change is a local extremum: a flat tangent there is what stops
    // the curve sailing past the point it is supposed to turn at.
    tangents[i] = a * b <= 0 ? 0 : (a + b) / 2;
  }

  for (let i = 0; i < n - 1; i += 1) {
    const s = secants[i]!;
    if (s === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const alpha = tangents[i]! / s;
    const beta = tangents[i + 1]! / s;
    const magnitude = Math.hypot(alpha, beta);
    if (magnitude > 3) {
      const scale = 3 / magnitude;
      tangents[i] = scale * alpha * s;
      tangents[i + 1] = scale * beta * s;
    }
  }
  return tangents;
}

/**
 * A 256-entry byte lookup table for a curve.
 *
 * Built once per curve and read per pixel: sampling the spline for every
 * channel of every pixel would be the same 256 answers computed millions of
 * times.
 */
export function buildCurveLut(
  points: readonly CurvePoint[],
): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i += 1) {
    lut[i] = Math.round(curvePoint(points, i / 255) * 255);
  }
  return lut;
}

export interface CurveSet {
  rgb: readonly CurvePoint[];
  red: readonly CurvePoint[];
  green: readonly CurvePoint[];
  blue: readonly CurvePoint[];
}

/**
 * Apply a curve set to an image.
 *
 * Per-channel first, then the composite, which is the order Photoshop's Curves
 * dialog implies: the per-channel curves decide the colour, and the composite
 * curve then shapes the tone of whatever colour resulted. Reversing it would
 * make a composite contrast boost change the colour balance a per-channel curve
 * had just set.
 *
 * The four LUTs are composed into three before the pixel loop, so a pixel costs
 * three lookups regardless of how many curves are in play.
 */
export function applyCurves(image: RasterImage, curves: CurveSet): RasterImage {
  const rgb = buildCurveLut(curves.rgb);
  const perChannel = [
    buildCurveLut(curves.red),
    buildCurveLut(curves.green),
    buildCurveLut(curves.blue),
  ];
  const composed = perChannel.map((channel) => {
    const out = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i += 1) out[i] = rgb[channel[i]!]!;
    return out;
  });

  const data = new Uint8ClampedArray(image.data);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = composed[0]![data[i]!]!;
    data[i + 1] = composed[1]![data[i + 1]!]!;
    data[i + 2] = composed[2]![data[i + 2]!]!;
  }
  return { width: image.width, height: image.height, data };
}
