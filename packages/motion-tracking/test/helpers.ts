import { sampleBilinear } from "../src/pyramid.js";
import type { FlowFrame } from "../src/types.js";

/**
 * Synthetic frames with known ground truth.
 *
 * The whole accuracy argument rests on these: a pattern is generated, moved by
 * an amount chosen here, and the tracker is asked to recover that amount. There
 * is no other honest way to test optical flow — comparing against real footage
 * only tells you the answer looks plausible.
 */

/** Deterministic PRNG, so a failure is always the same failure. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Broadband value noise: random values on a coarse lattice, interpolated, and
 * summed over octaves.
 *
 * **Not a sum of sinusoids.** The first version of this was, and it made the
 * large-motion test fail against a tracker that was working: the dominant term
 * had a period of about 30 pixels, so a 12-pixel shift aliased onto a false
 * match one period away and the tracker locked to it — correctly, given what it
 * was shown. Any periodic pattern has many equally good matches, which makes it
 * useless for judging displacement.
 *
 * Value noise has no period, so the true match is the only good one, and a
 * wrong answer here means a wrong tracker.
 */
export function texture(width: number, height: number): FlowFrame {
  const luma = new Uint8ClampedArray(width * height);
  const value = new Float64Array(width * height);

  for (const [cell, amplitude] of [
    [4, 1],
    [11, 0.7],
    [29, 0.5],
  ] as const) {
    const cols = Math.ceil(width / cell) + 2;
    const rows = Math.ceil(height / cell) + 2;
    const random = lcg(0x9e3779b9 ^ (cell * 2654435761));
    const lattice = new Float64Array(cols * rows);
    for (let i = 0; i < lattice.length; i += 1) lattice[i] = random();

    for (let y = 0; y < height; y += 1) {
      const gy = y / cell;
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      for (let x = 0; x < width; x += 1) {
        const gx = x / cell;
        const x0 = Math.floor(gx);
        const fx = gx - x0;
        const p00 = lattice[y0 * cols + x0]!;
        const p10 = lattice[y0 * cols + x0 + 1]!;
        const p01 = lattice[(y0 + 1) * cols + x0]!;
        const p11 = lattice[(y0 + 1) * cols + x0 + 1]!;
        // Smoothstep on the cell fraction: linear interpolation alone leaves
        // creases on the lattice lines, which are strong fake edges.
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const top = p00 + (p10 - p00) * sx;
        const bottom = p01 + (p11 - p01) * sx;
        value[y * width + x]! += amplitude * (top + (bottom - top) * sy);
      }
    }
  }

  let lo = Infinity;
  let hi = -Infinity;
  for (const v of value) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  for (let i = 0; i < value.length; i += 1) {
    luma[i] = Math.round(((value[i]! - lo) / span) * 230 + 12);
  }
  return { width, height, luma };
}

/** A featureless field — nothing to lock onto, by construction. */
export function flat(width: number, height: number, value = 128): FlowFrame {
  return {
    width,
    height,
    luma: new Uint8ClampedArray(width * height).fill(value),
  };
}

/**
 * Resample a frame through an arbitrary inverse mapping.
 *
 * Sampling the *source* for each destination pixel, rather than pushing pixels
 * forward, so the result has no holes. Bilinear, which is why sub-pixel shifts
 * are meaningful rather than rounded away before the tracker ever sees them.
 */
export function warp(
  frame: FlowFrame,
  inverse: (x: number, y: number) => { x: number; y: number },
): FlowFrame {
  const luma = new Uint8ClampedArray(frame.width * frame.height);
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const source = inverse(x, y);
      luma[y * frame.width + x] = Math.round(
        sampleBilinear(frame, source.x, source.y),
      );
    }
  }
  return { width: frame.width, height: frame.height, luma };
}

/** Move the picture by (dx, dy). A feature at p appears at p + (dx, dy). */
export function translate(frame: FlowFrame, dx: number, dy: number): FlowFrame {
  return warp(frame, (x, y) => ({ x: x - dx, y: y - dy }));
}

/** Rotate about the frame centre by `radians`, positive counter-clockwise in
 * image coordinates, optionally scaling about the same point. */
export function rotate(
  frame: FlowFrame,
  radians: number,
  scale = 1,
): FlowFrame {
  const cx = (frame.width - 1) / 2;
  const cy = (frame.height - 1) / 2;
  // The inverse map: undo the scale, then the rotation.
  const cos = Math.cos(-radians) / scale;
  const sin = Math.sin(-radians) / scale;
  return warp(frame, (x, y) => {
    const px = x - cx;
    const py = y - cy;
    return { x: cx + px * cos - py * sin, y: cy + px * sin + py * cos };
  });
}

/** Paint a moving block into a copy of `frame` — a subject crossing an
 * otherwise still scene. */
export function withBlock(
  frame: FlowFrame,
  x0: number,
  y0: number,
  size: number,
): FlowFrame {
  const luma = new Uint8ClampedArray(frame.luma);
  for (let y = y0; y < y0 + size; y += 1) {
    for (let x = x0; x < x0 + size; x += 1) {
      if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) continue;
      // Textured, not flat: a flat block has nothing to track, so it would be
      // discarded as featureless rather than rejected as an outlier — which
      // would not test the outlier rejection at all.
      luma[y * frame.width + x] = ((x * 37 + y * 53) % 200) + 28;
    }
  }
  return { width: frame.width, height: frame.height, luma };
}
