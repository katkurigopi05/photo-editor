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
