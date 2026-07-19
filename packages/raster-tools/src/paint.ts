import { inBounds, pixelIndex, type Mask, type RasterImage } from "./types.js";

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number; // 0..1
}

/** Soft-circle falloff: 1 inside `radius * hardness`, smoothstep to 0 at
 * `radius`, 0 beyond. `hardness` in [0, 1]; 1 = hard-edged circle. */
function edgeFalloff(
  distance: number,
  radius: number,
  hardness: number,
): number {
  if (radius <= 0) return 0;
  const innerRadius = radius * hardness;
  if (distance <= innerRadius) return 1;
  if (distance >= radius) return 0;
  const t = (distance - innerRadius) / (radius - innerRadius || 1);
  // smoothstep
  return 1 - t * t * (3 - 2 * t);
}

/** Paint (source-over blend) or erase (alpha reduction) a soft circular stamp
 * onto `image` in place, centered at (cx, cy). Mutates and returns `image`. */
export function stampBrush(
  image: RasterImage,
  cx: number,
  cy: number,
  radiusPx: number,
  color: RgbaColor,
  opacity: number,
  mode: "paint" | "erase",
  hardness = 1,
): RasterImage {
  const { width, height, data } = image;
  const r = Math.max(0, radiusPx);
  const xMin = Math.max(0, Math.floor(cx - r));
  const xMax = Math.min(width - 1, Math.ceil(cx + r));
  const yMin = Math.max(0, Math.floor(cy - r));
  const yMax = Math.min(height - 1, Math.ceil(cy + r));

  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const falloff = edgeFalloff(dist, r, hardness);
      if (falloff <= 0) continue;
      const alpha = Math.max(0, Math.min(1, opacity)) * falloff;
      const p = pixelIndex(x, y, width);
      if (mode === "erase") {
        data[p + 3] = Math.round(data[p + 3]! * (1 - alpha));
      } else {
        data[p] = Math.round(data[p]! * (1 - alpha) + color.r * alpha);
        data[p + 1] = Math.round(data[p + 1]! * (1 - alpha) + color.g * alpha);
        data[p + 2] = Math.round(data[p + 2]! * (1 - alpha) + color.b * alpha);
        const srcAlpha = color.a * alpha;
        data[p + 3] = Math.round(
          data[p + 3]! * (1 - srcAlpha) + 255 * srcAlpha,
        );
      }
    }
  }
  return image;
}

/** Copy a soft circular region from `source` at (sx, sy) onto `dest` at
 * (dx, dy), blended by `opacity`. Classic clone-stamp tool. Mutates and
 * returns `dest`. Pass a snapshot as `source` to avoid smearing within a
 * single overlapping stamp. */
export function cloneStamp(
  dest: RasterImage,
  source: RasterImage,
  sx: number,
  sy: number,
  dx: number,
  dy: number,
  radiusPx: number,
  opacity: number,
  hardness = 1,
): RasterImage {
  const r = Math.max(0, radiusPx);
  const offsetX = Math.round(sx - dx);
  const offsetY = Math.round(sy - dy);
  const xMin = Math.max(0, Math.floor(dx - r));
  const xMax = Math.min(dest.width - 1, Math.ceil(dx + r));
  const yMin = Math.max(0, Math.floor(dy - r));
  const yMax = Math.min(dest.height - 1, Math.ceil(dy + r));

  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      const srcX = x + offsetX;
      const srcY = y + offsetY;
      if (!inBounds(srcX, srcY, source.width, source.height)) continue;
      const dist = Math.hypot(x + 0.5 - dx, y + 0.5 - dy);
      const falloff = edgeFalloff(dist, r, hardness);
      if (falloff <= 0) continue;
      const alpha = Math.max(0, Math.min(1, opacity)) * falloff;
      const sp = pixelIndex(srcX, srcY, source.width);
      const dp = pixelIndex(x, y, dest.width);
      dest.data[dp] = Math.round(
        dest.data[dp]! * (1 - alpha) + source.data[sp]! * alpha,
      );
      dest.data[dp + 1] = Math.round(
        dest.data[dp + 1]! * (1 - alpha) + source.data[sp + 1]! * alpha,
      );
      dest.data[dp + 2] = Math.round(
        dest.data[dp + 2]! * (1 - alpha) + source.data[sp + 2]! * alpha,
      );
      dest.data[dp + 3] = Math.round(
        dest.data[dp + 3]! * (1 - alpha) + source.data[sp + 3]! * alpha,
      );
    }
  }
  return dest;
}

/** Clear pixels under `mask`, weighted by the mask's (possibly feathered)
 * value. Mutates and returns `image`. */
export function applyMaskDelete(image: RasterImage, mask: Mask): RasterImage {
  const { data } = image;
  for (let i = 0; i < mask.data.length; i++) {
    const weight = mask.data[i]! / 255;
    if (weight === 0) continue;
    const p = i * 4;
    data[p + 3] = Math.round(data[p + 3]! * (1 - weight));
  }
  return image;
}

/** Composite a flat color over pixels under `mask`, weighted by the mask
 * value and the color's own alpha. Mutates and returns `image`. */
export function applyMaskFill(
  image: RasterImage,
  mask: Mask,
  color: RgbaColor,
): RasterImage {
  const { data } = image;
  for (let i = 0; i < mask.data.length; i++) {
    const weight = (mask.data[i]! / 255) * color.a;
    if (weight === 0) continue;
    const p = i * 4;
    data[p] = Math.round(data[p]! * (1 - weight) + color.r * weight);
    data[p + 1] = Math.round(data[p + 1]! * (1 - weight) + color.g * weight);
    data[p + 2] = Math.round(data[p + 2]! * (1 - weight) + color.b * weight);
    data[p + 3] = Math.round(data[p + 3]! * (1 - weight) + 255 * weight);
  }
  return image;
}
