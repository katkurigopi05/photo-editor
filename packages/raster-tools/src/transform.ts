import { createImage, pixelIndex, type RasterImage } from "./types.js";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Crop to `rect`, clamped to the image bounds. Out-of-bounds pixels are
 * transparent black. */
export function cropImage(image: RasterImage, rect: Rect): RasterImage {
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const out = createImage(width, height);
  const ox = Math.round(rect.x);
  const oy = Math.round(rect.y);
  for (let y = 0; y < height; y++) {
    const srcY = y + oy;
    if (srcY < 0 || srcY >= image.height) continue;
    for (let x = 0; x < width; x++) {
      const srcX = x + ox;
      if (srcX < 0 || srcX >= image.width) continue;
      const sp = pixelIndex(srcX, srcY, image.width);
      const dp = pixelIndex(x, y, width);
      out.data[dp] = image.data[sp]!;
      out.data[dp + 1] = image.data[sp + 1]!;
      out.data[dp + 2] = image.data[sp + 2]!;
      out.data[dp + 3] = image.data[sp + 3]!;
    }
  }
  return out;
}

function sampleBilinear(
  image: RasterImage,
  fx: number,
  fy: number,
): [number, number, number, number] {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  if (x0 < 0 || y0 < 0 || x0 >= image.width || y0 >= image.height) {
    return [0, 0, 0, 0];
  }
  const p00 = pixelIndex(x0, y0, image.width);
  const p10 = pixelIndex(x1, y0, image.width);
  const p01 = pixelIndex(x0, y1, image.width);
  const p11 = pixelIndex(x1, y1, image.width);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const channel = (c: number): number => {
    const top = lerp(image.data[p00 + c]!, image.data[p10 + c]!, tx);
    const bottom = lerp(image.data[p01 + c]!, image.data[p11 + c]!, tx);
    return lerp(top, bottom, ty);
  };
  return [channel(0), channel(1), channel(2), channel(3)];
}

/** Bilinear resize to `newWidth` x `newHeight`. */
export function resizeImage(
  image: RasterImage,
  newWidth: number,
  newHeight: number,
): RasterImage {
  const width = Math.max(1, Math.round(newWidth));
  const height = Math.max(1, Math.round(newHeight));
  const out = createImage(width, height);
  const scaleX = image.width / width;
  const scaleY = image.height / height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = sampleBilinear(
        image,
        (x + 0.5) * scaleX - 0.5,
        (y + 0.5) * scaleY - 0.5,
      );
      const dp = pixelIndex(x, y, width);
      out.data[dp] = r;
      out.data[dp + 1] = g;
      out.data[dp + 2] = b;
      out.data[dp + 3] = a;
    }
  }
  return out;
}

/** Rotate by `degrees` about the image center, into a new buffer sized to
 * fit the full rotated bounding box (nothing is cropped). */
export function rotateImage(image: RasterImage, degrees: number): RasterImage {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const { width: w, height: h } = image;
  const corners = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const cx0 = w / 2;
  const cy0 = h / 2;
  for (const [px, py] of corners) {
    const dx = px! - cx0;
    const dy = py! - cy0;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry;
    if (ry > maxY) maxY = ry;
  }
  const outWidth = Math.max(1, Math.round(maxX - minX));
  const outHeight = Math.max(1, Math.round(maxY - minY));
  const out = createImage(outWidth, outHeight);
  const outCx = outWidth / 2;
  const outCy = outHeight / 2;
  // Inverse-map each output pixel back into source space.
  const invCos = Math.cos(-rad);
  const invSin = Math.sin(-rad);
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const dx = x - outCx;
      const dy = y - outCy;
      const srcX = dx * invCos - dy * invSin + cx0;
      const srcY = dx * invSin + dy * invCos + cy0;
      const [r, g, b, a] = sampleBilinear(image, srcX, srcY);
      const dp = pixelIndex(x, y, outWidth);
      out.data[dp] = r;
      out.data[dp + 1] = g;
      out.data[dp + 2] = b;
      out.data[dp + 3] = a;
    }
  }
  return out;
}

/** Shift pixel content by (dx, dy) within a same-size buffer; the vacated
 * area is left transparent. Used for the "Move" tool without a layer stack. */
export function shiftImage(
  image: RasterImage,
  dx: number,
  dy: number,
): RasterImage {
  const { width, height } = image;
  const out = createImage(width, height);
  const ox = Math.round(dx);
  const oy = Math.round(dy);
  for (let y = 0; y < height; y++) {
    const srcY = y - oy;
    if (srcY < 0 || srcY >= height) continue;
    for (let x = 0; x < width; x++) {
      const srcX = x - ox;
      if (srcX < 0 || srcX >= width) continue;
      const sp = pixelIndex(srcX, srcY, width);
      const dp = pixelIndex(x, y, width);
      out.data[dp] = image.data[sp]!;
      out.data[dp + 1] = image.data[sp + 1]!;
      out.data[dp + 2] = image.data[sp + 2]!;
      out.data[dp + 3] = image.data[sp + 3]!;
    }
  }
  return out;
}
