import {
  cloneImage,
  pixelIndex,
  type Mask,
  type RasterImage,
  type RgbColor,
} from "./types.js";

const MAX_COLOR_DISTANCE = Math.sqrt(3) * 255;

/** Separable box blur over the RGB channels (alpha untouched), via a running
 * sum so cost is independent of radius. */
export function boxBlurRgb(image: RasterImage, radiusPx: number): RasterImage {
  const r = Math.max(0, Math.round(radiusPx));
  const { width, height } = image;
  const out = cloneImage(image);
  if (r === 0) return out;

  const blurChannel = (
    getIn: (i: number) => number,
    channelOffset: number,
    length: number,
    stride: number,
    base: number,
  ): void => {
    let sum = 0;
    for (let i = 0; i <= Math.min(r, length - 1); i++) sum += getIn(i);
    for (let i = 0; i < length; i++) {
      const windowLen = Math.min(length - 1, i + r) - Math.max(0, i - r) + 1;
      out.data[base + i * stride + channelOffset] = Math.round(sum / windowLen);
      const addIdx = i + r + 1;
      const removeIdx = i - r;
      if (addIdx < length) sum += getIn(addIdx);
      if (removeIdx >= 0) sum -= getIn(removeIdx);
    }
  };

  // horizontal pass, then vertical, per channel
  const horiz = cloneImage(image);
  for (let channel = 0; channel < 3; channel++) {
    for (let y = 0; y < height; y++) {
      const rowBase = y * width * 4;
      blurChannel(
        (x) => image.data[rowBase + x * 4 + channel]!,
        channel,
        width,
        4,
        rowBase,
      );
    }
  }
  horiz.data.set(out.data);
  for (let channel = 0; channel < 3; channel++) {
    for (let x = 0; x < width; x++) {
      blurChannel(
        (y) => horiz.data[y * width * 4 + x * 4 + channel]!,
        channel,
        height,
        width * 4,
        x * 4,
      );
    }
  }
  return out;
}

/** Classic unsharp mask: `out = image + amount * (image - blur(image))`.
 * `amount` in [0, 3] (0 = no change). Alpha is left untouched. */
export function unsharpMask(
  image: RasterImage,
  amount: number,
  radiusPx = 1,
): RasterImage {
  const blurred = boxBlurRgb(image, radiusPx);
  const out = cloneImage(image);
  for (let i = 0; i < image.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const original = image.data[i + c]!;
      const detail = original - blurred.data[i + c]!;
      out.data[i + c] = original + amount * detail;
    }
  }
  return out;
}

/**
 * "Smart Fill" — harmonic (Laplace) diffusion inpainting. Masked pixels are
 * repeatedly replaced by the average of their unmasked/already-relaxed
 * 4-neighbors (Gauss-Seidel relaxation), which converges to the smoothest
 * plausible fill consistent with the surrounding pixels. This is a real,
 * well-established classical technique (no ML model, no network call, no
 * bundled weights) — not a stub, and not "AI".
 */
export function diffusionFill(
  image: RasterImage,
  mask: Mask,
  iterations = 200,
): RasterImage {
  const { width, height } = image;
  const out = cloneImage(image);
  const masked = new Uint8Array(width * height);
  const indices: number[] = [];
  for (let i = 0; i < mask.data.length; i++) {
    if (mask.data[i]! > 127) {
      masked[i] = 1;
      indices.push(i);
    }
  }
  if (indices.length === 0) return out;

  // Seed masked pixels with the mean color of their unmasked neighbors (or
  // the image mean as a fallback) so relaxation starts from a sane baseline.
  for (const cell of indices) {
    const x = cell % width;
    const y = (cell - x) / width;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let n = 0;
    for (const [nx, ny] of neighbors4(x, y, width, height)) {
      const nCell = ny * width + nx;
      if (masked[nCell]) continue;
      const p = nCell * 4;
      sr += out.data[p]!;
      sg += out.data[p + 1]!;
      sb += out.data[p + 2]!;
      n++;
    }
    if (n > 0) {
      const p = cell * 4;
      out.data[p] = Math.round(sr / n);
      out.data[p + 1] = Math.round(sg / n);
      out.data[p + 2] = Math.round(sb / n);
    }
  }

  for (let iter = 0; iter < iterations; iter++) {
    for (const cell of indices) {
      const x = cell % width;
      const y = (cell - x) / width;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (const [nx, ny] of neighbors4(x, y, width, height)) {
        const p = (ny * width + nx) * 4;
        sr += out.data[p]!;
        sg += out.data[p + 1]!;
        sb += out.data[p + 2]!;
        n++;
      }
      const p = cell * 4;
      out.data[p] = Math.round(sr / n);
      out.data[p + 1] = Math.round(sg / n);
      out.data[p + 2] = Math.round(sb / n);
      out.data[p + 3] = 255;
    }
  }
  return out;
}

function* neighbors4(
  x: number,
  y: number,
  width: number,
  height: number,
): Generator<[number, number]> {
  if (x > 0) yield [x - 1, y];
  if (x < width - 1) yield [x + 1, y];
  if (y > 0) yield [x, y - 1];
  if (y < height - 1) yield [x, y + 1];
}

/** Color-key alpha: pixels within `threshold` of `key` become transparent,
 * with a linear soft edge out to `threshold + softness`. Deterministic; no
 * ML model. Same semantics as the `fx.remove_background` effect. */
export function colorKeyAlpha(
  image: RasterImage,
  key: RgbColor,
  threshold: number,
  softness: number,
): RasterImage {
  const out = cloneImage(image);
  const t = threshold * MAX_COLOR_DISTANCE;
  const s = softness * MAX_COLOR_DISTANCE;
  for (let i = 0; i < out.data.length; i += 4) {
    const dist = Math.hypot(
      out.data[i]! - key.r,
      out.data[i + 1]! - key.g,
      out.data[i + 2]! - key.b,
    );
    if (dist <= t) {
      out.data[i + 3] = 0;
    } else if (s > 0 && dist <= t + s) {
      out.data[i + 3] = Math.round(out.data[i + 3]! * ((dist - t) / s));
    }
  }
  return out;
}

/** Average color of the four image corners (small sampling window), used to
 * auto-detect a background key color without user input. */
export function cornerKeyColor(image: RasterImage, sample = 4): RgbColor {
  const { width, height, data } = image;
  const points = [
    [0, 0],
    [width - sample, 0],
    [0, height - sample],
    [width - sample, height - sample],
  ] as const;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const [sx, sy] of points) {
    for (let dy = 0; dy < sample; dy++) {
      for (let dx = 0; dx < sample; dx++) {
        const x = Math.max(0, Math.min(width - 1, sx + dx));
        const y = Math.max(0, Math.min(height - 1, sy + dy));
        const p = pixelIndex(x, y, width);
        r += data[p]!;
        g += data[p + 1]!;
        b += data[p + 2]!;
        n++;
      }
    }
  }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}
