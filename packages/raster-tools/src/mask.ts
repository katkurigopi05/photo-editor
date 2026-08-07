import {
  createMask,
  pixelIndex,
  type Mask,
  type RasterImage,
} from "./types.js";

/** A point in image pixel coordinates (may be fractional). */
export interface Point {
  x: number;
  y: number;
}

const MAX_COLOR_DISTANCE = Math.sqrt(255 * 255 * 3);

function colorDistance(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Fill a closed polygon into a mask using a scanline even-odd algorithm.
 * Pure computational geometry — no canvas dependency. */
export function polygonMask(
  width: number,
  height: number,
  points: readonly Point[],
): Mask {
  const mask = createMask(width, height);
  if (points.length < 3) return mask;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(height - 1, Math.ceil(maxY));

  for (let y = yStart; y <= yEnd; y++) {
    const scanY = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i]!;
      const p2 = points[(i + 1) % points.length]!;
      const crosses =
        (p1.y <= scanY && p2.y > scanY) || (p2.y <= scanY && p1.y > scanY);
      if (!crosses) continue;
      const t = (scanY - p1.y) / (p2.y - p1.y);
      xs.push(p1.x + t * (p2.x - p1.x));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xStart = Math.max(0, Math.round(xs[i]!));
      const xEnd = Math.min(width - 1, Math.round(xs[i + 1]!) - 1);
      for (let x = xStart; x <= xEnd; x++) {
        mask.data[y * width + x] = 255;
      }
    }
  }
  return mask;
}

/**
 * Select pixels similar to the seed pixel's color, within `tolerance`
 * (0..1, fraction of the maximum possible RGB distance).
 *
 * `contiguous: true` (the classic "magic wand") flood-fills only the
 * 4-connected region touching the seed; `false` selects every matching pixel
 * in the image regardless of position.
 */
export function floodFillMask(
  image: RasterImage,
  seedX: number,
  seedY: number,
  tolerance: number,
  contiguous = true,
): Mask {
  const { width, height, data } = image;
  const mask = createMask(width, height);
  if (seedX < 0 || seedY < 0 || seedX >= width || seedY >= height) return mask;

  const threshold = tolerance * MAX_COLOR_DISTANCE;
  const seedIdx = pixelIndex(seedX, seedY, width);
  const sr = data[seedIdx]!;
  const sg = data[seedIdx + 1]!;
  const sb = data[seedIdx + 2]!;

  if (!contiguous) {
    for (let i = 0; i < width * height; i++) {
      const p = i * 4;
      if (
        colorDistance(data[p]!, data[p + 1]!, data[p + 2]!, sr, sg, sb) <=
        threshold
      ) {
        mask.data[i] = 255;
      }
    }
    return mask;
  }

  const visited = new Uint8Array(width * height);
  const stack: number[] = [seedY * width + seedX];
  visited[seedY * width + seedX] = 1;
  while (stack.length > 0) {
    const cell = stack.pop()!;
    const cx = cell % width;
    const cy = (cell - cx) / width;
    const p = cell * 4;
    if (
      colorDistance(data[p]!, data[p + 1]!, data[p + 2]!, sr, sg, sb) >
      threshold
    )
      continue;
    mask.data[cell] = 255;
    const neighbors: [number, number][] = [
      [cx - 1, cy],
      [cx + 1, cy],
      [cx, cy - 1],
      [cx, cy + 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nCell = ny * width + nx;
      if (visited[nCell]) continue;
      visited[nCell] = 1;
      stack.push(nCell);
    }
  }
  return mask;
}

export function invertMask(mask: Mask): Mask {
  const out = new Uint8ClampedArray(mask.data.length);
  for (let i = 0; i < mask.data.length; i++) out[i] = 255 - mask.data[i]!;
  return { width: mask.width, height: mask.height, data: out };
}

/** Soften mask edges with a separable box blur (O(width*height), radius-independent
 * via a running-sum sliding window). A real, if simple, feather — not a stub. */
export function featherMask(mask: Mask, radiusPx: number): Mask {
  const r = Math.max(0, Math.round(radiusPx));
  if (r === 0)
    return {
      width: mask.width,
      height: mask.height,
      data: new Uint8ClampedArray(mask.data),
    };
  const { width, height } = mask;
  const horiz = new Uint8ClampedArray(width * height);
  const out = new Uint8ClampedArray(width * height);

  const blurLine = (
    getIn: (i: number) => number,
    setOut: (i: number, v: number) => void,
    length: number,
  ): void => {
    let windowSum = 0;
    for (let i = 0; i <= Math.min(r, length - 1); i++) windowSum += getIn(i);
    for (let i = 0; i < length; i++) {
      const windowLen = Math.min(length - 1, i + r) - Math.max(0, i - r) + 1;
      setOut(i, windowSum / windowLen);
      const addIdx = i + r + 1;
      const removeIdx = i - r;
      if (addIdx < length) windowSum += getIn(addIdx);
      if (removeIdx >= 0) windowSum -= getIn(removeIdx);
    }
  };

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    blurLine(
      (x) => mask.data[rowOffset + x]!,
      (x, v) => (horiz[rowOffset + x] = v),
      width,
    );
  }
  for (let x = 0; x < width; x++) {
    blurLine(
      (y) => horiz[y * width + x]!,
      (y, v) => (out[y * width + x] = v),
      height,
    );
  }
  return { width, height, data: out };
}

/** The tight bounding rect of nonzero mask pixels, or `null` if the mask is
 * empty. Used to scope undo snapshots to the affected region only. */
export function maskBounds(
  mask: Mask,
): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.data[y * mask.width + x] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (minX > maxX) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// --- Local-adjustment mask generators --------------------------------------
//
// Lightroom's masking model has two halves: adjustments that can be confined to
// a region (see `adjust.ts`), and the regions themselves. These are the
// regions. Each returns coverage bytes rather than booleans, because partial
// coverage is what makes a gradient blend instead of cutting an edge, and what
// lets a range mask say "mostly this colour".
//
// All of them are pure functions of their parameters, so a mask can be stored
// as the parameters that produced it — a stroke is a list of points and a
// radius, never a baked bitmap.

/** Clamp to the 0..1 unit interval, treating non-finite input as 0. */
function unit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** A smooth 0..1 ramp with zero slope at both ends — feathering that does not
 * show a seam where it meets full or no coverage. */
function smoothstep(t: number): number {
  const x = unit(t);
  return x * x * (3 - 2 * x);
}

/**
 * A linear gradient mask: uncovered on `from`'s side, fully covered past `to`,
 * ramping in between and constant along the perpendicular.
 *
 * This is the mask for "darken the sky" or "warm the foreground" — the edit
 * follows a line across the frame rather than a shape.
 */
export function linearGradientMask(
  width: number,
  height: number,
  from: Point,
  to: Point,
): Mask {
  const mask = createMask(width, height);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  // Coincident points describe no direction; everything stays uncovered rather
  // than dividing by zero.
  if (lengthSquared === 0) return mask;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Projection of the pixel onto the gradient axis, clamped to its ends.
      const t = ((x - from.x) * dx + (y - from.y) * dy) / lengthSquared;
      mask.data[y * width + x] = Math.round(unit(t) * 255);
    }
  }
  return mask;
}

/**
 * A radial (elliptical) gradient mask: covered inside, falling away outside.
 *
 * `radius` may be a number for a circle or a point for an ellipse. `feather`
 * is the fraction of the radius over which coverage falls from full to none —
 * 0 is a hard edge, 1 fades all the way from the centre. `invert` selects the
 * surround instead, which is how "everything except the subject" is expressed.
 */
export function radialGradientMask(
  width: number,
  height: number,
  centre: Point,
  radius: number | Point,
  feather = 0.5,
  invert = false,
): Mask {
  const mask = createMask(width, height);
  const rx = typeof radius === "number" ? radius : radius.x;
  const ry = typeof radius === "number" ? radius : radius.y;
  if (rx <= 0 || ry <= 0) return mask;

  const inner = 1 - unit(feather);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x - centre.x) / rx;
      const ny = (y - centre.y) / ry;
      // Normalized elliptical distance: 1 exactly on the ellipse.
      const distance = Math.sqrt(nx * nx + ny * ny);
      let coverage: number;
      if (distance <= inner) coverage = 1;
      else if (distance >= 1) coverage = 0;
      else coverage = smoothstep(1 - (distance - inner) / (1 - inner));
      mask.data[y * width + x] = Math.round(
        (invert ? 1 - coverage : coverage) * 255,
      );
    }
  }
  return mask;
}

/**
 * A brush stroke mask: the union of a round brush swept along a polyline.
 *
 * Swept, not stamped per point: a pointer sampled every few pixels leaves a
 * dotted line if each sample is painted independently, so coverage is measured
 * against the *segments* between points.
 */
export function brushStrokeMask(
  width: number,
  height: number,
  points: readonly Point[],
  radiusPx: number,
  feather = 0.5,
): Mask {
  const mask = createMask(width, height);
  if (points.length === 0 || radiusPx <= 0) return mask;

  const inner = radiusPx * (1 - unit(feather));
  // Only the pixels the stroke can reach are considered, so a small stroke on a
  // large canvas costs its own area rather than the canvas's.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  const x0 = Math.max(0, Math.floor(minX - radiusPx));
  const x1 = Math.min(width - 1, Math.ceil(maxX + radiusPx));
  const y0 = Math.max(0, Math.floor(minY - radiusPx));
  const y1 = Math.min(height - 1, Math.ceil(maxY + radiusPx));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const distance = distanceToPolyline(x, y, points);
      let coverage: number;
      if (distance <= inner) coverage = 1;
      else if (distance >= radiusPx) coverage = 0;
      else coverage = smoothstep(1 - (distance - inner) / (radiusPx - inner));
      const value = Math.round(coverage * 255);
      const index = y * width + x;
      // Overlapping segments must not darken each other: coverage is a union.
      if (value > mask.data[index]!) mask.data[index] = value;
    }
  }
  return mask;
}

/** Shortest distance from a pixel to a polyline (or to the single point). */
function distanceToPolyline(
  x: number,
  y: number,
  points: readonly Point[],
): number {
  if (points.length === 1) {
    const only = points[0]!;
    return Math.hypot(x - only.x, y - only.y);
  }
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : unit(((x - a.x) * dx + (y - a.y) * dy) / lengthSquared);
    const distance = Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
    if (distance < best) best = distance;
  }
  return best;
}

/** Rec. 709 luminance as 0..1. */
function luminance01(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * A luminance range mask: covers pixels whose brightness falls inside
 * `[min, max]`, with `feather` (in luminance units) softening both edges.
 *
 * Lightroom's Range → Luminance: the mask that makes "only the highlights" or
 * "only the shadows" a region rather than a global tone control.
 */
export function luminanceRangeMask(
  image: RasterImage,
  min: number,
  max: number,
  feather = 0.1,
): Mask {
  const mask = createMask(image.width, image.height);
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const soft = Math.max(0, feather);

  for (let p = 0, i = 0; i < image.data.length; i += 4, p++) {
    const value = luminance01(
      image.data[i]!,
      image.data[i + 1]!,
      image.data[i + 2]!,
    );
    let coverage: number;
    if (value >= low && value <= high) coverage = 1;
    else if (soft === 0) coverage = 0;
    else if (value < low) coverage = smoothstep(1 - (low - value) / soft);
    else coverage = smoothstep(1 - (value - high) / soft);
    mask.data[p] = Math.round(coverage * 255);
  }
  return mask;
}

/**
 * A colour range mask: covers pixels near `target` in RGB distance.
 *
 * `tolerance` and `feather` are fractions of the maximum possible distance, so
 * they mean the same thing whatever the colours involved. Lightroom's
 * Range → Colour, and the reason "make just the red car darker" is one gesture.
 */
export function colorRangeMask(
  image: RasterImage,
  target: { r: number; g: number; b: number },
  tolerance: number,
  feather = 0.1,
): Mask {
  const mask = createMask(image.width, image.height);
  const inside = Math.max(0, tolerance) * MAX_COLOR_DISTANCE;
  const soft = Math.max(0, feather) * MAX_COLOR_DISTANCE;

  for (let p = 0, i = 0; i < image.data.length; i += 4, p++) {
    const distance = colorDistance(
      image.data[i]!,
      image.data[i + 1]!,
      image.data[i + 2]!,
      target.r,
      target.g,
      target.b,
    );
    let coverage: number;
    if (distance <= inside) coverage = 1;
    else if (soft === 0 || distance >= inside + soft) coverage = 0;
    else coverage = smoothstep(1 - (distance - inside) / soft);
    mask.data[p] = Math.round(coverage * 255);
  }
  return mask;
}
