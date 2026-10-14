/**
 * Lightroom-inspired Targeted Point Color Engine.
 *
 * Allows sampling an exact color in 3D color space (Hue, Saturation, Luminance),
 * isolating a customizable range volume with soft feathering falloff,
 * shifting hue, scaling saturation and luminance, and visualizing the active selection.
 */

export interface PointColorTarget {
  /** Target Hue in degrees [0, 360). */
  hue: number;
  /** Target Saturation [0, 1]. */
  saturation: number;
  /** Target Luminance [0, 1]. */
  luminance: number;
}

export interface PointColorRange {
  /** Hue tolerance in degrees (default 20). */
  hueTolerance?: number;
  /** Saturation tolerance [0, 1] (default 0.3). */
  saturationTolerance?: number;
  /** Luminance tolerance [0, 1] (default 0.3). */
  luminanceTolerance?: number;
  /** Feather softness [0, 1] for transition falloff (default 0.5). */
  feather?: number;
}

export interface PointColorAdjustment {
  /** Degrees to shift the selected hue [-180, 180]. */
  hueShift?: number;
  /** Multiplier for saturation [0, 2] where 1.0 is no change. */
  saturationScale?: number;
  /** Offset for luminance [-1, 1] where 0.0 is no change. */
  luminanceShift?: number;
}

export interface PointColorOptions {
  target: PointColorTarget;
  range?: PointColorRange;
  adjustment?: PointColorAdjustment;
  /** If true, renders unselected areas in monochrome (Lightroom "Visualize Range" mode). */
  visualizeRange?: boolean;
}

function createImageData(width: number, height: number, data?: Uint8ClampedArray): ImageData {
  const pixelData = data ?? new Uint8ClampedArray(width * height * 4);
  if (typeof ImageData !== "undefined") {
    return new ImageData(pixelData as unknown as Uint8ClampedArray<ArrayBuffer>, width, height);
  }
  return { data: pixelData, width, height } as unknown as ImageData;
}

/**
 * Convert RGB [0..255] to HSL [0..360, 0..1, 0..1].
 */
export function pointRgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;

  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const l = (max + min) / 2;

  if (max === min) {
    return [0, 0, l];
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  switch (max) {
    case rf:
      h = (gf - bf) / d + (gf < bf ? 6 : 0);
      break;
    case gf:
      h = (bf - rf) / d + 2;
      break;
    case bf:
      h = (rf - gf) / d + 4;
      break;
  }
  h = (h * 60) % 360;

  return [h, s, l];
}

function hueToRgb(p: number, q: number, t: number): number {
  let tc = t;
  if (tc < 0) tc += 1;
  if (tc > 1) tc -= 1;
  if (tc < 1 / 6) return p + (q - p) * 6 * tc;
  if (tc < 1 / 2) return q;
  if (tc < 2 / 3) return p + (q - p) * (2 / 3 - tc) * 6;
  return p;
}

/**
 * Convert HSL [0..360, 0..1, 0..1] to RGB [0..255].
 */
export function pointHslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s <= 0) {
    const val = Math.round(l * 255);
    return [val, val, val];
  }

  const hn = (h % 360 + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const r = Math.round(hueToRgb(p, q, hn + 1 / 3) * 255);
  const g = Math.round(hueToRgb(p, q, hn) * 255);
  const b = Math.round(hueToRgb(p, q, hn - 1 / 3) * 255);

  return [
    Math.max(0, Math.min(255, r)),
    Math.max(0, Math.min(255, g)),
    Math.max(0, Math.min(255, b)),
  ];
}

/**
 * Calculates the smallest angular distance between two hues [0, 360).
 */
export function hueDistance(h1: number, h2: number): number {
  const diff = Math.abs(h1 - h2) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Compute the selection weight [0, 1] of a pixel given the target color and tolerances.
 */
export function calculatePointColorWeight(
  h: number,
  s: number,
  l: number,
  target: PointColorTarget,
  range: PointColorRange = {},
): number {
  const hTol = range.hueTolerance ?? 20;
  const sTol = range.saturationTolerance ?? 0.3;
  const lTol = range.luminanceTolerance ?? 0.3;
  const feather = Math.max(0.01, range.feather ?? 0.5);

  const hDist = hueDistance(h, target.hue);
  const sDist = Math.abs(s - target.saturation);
  const lDist = Math.abs(l - target.luminance);

  // Core volume boundaries
  const hMax = hTol * (1 + feather);
  const sMax = sTol * (1 + feather);
  const lMax = lTol * (1 + feather);

  if (hDist > hMax || sDist > sMax || lDist > lMax) {
    return 0;
  }

  // Smooth Hermite interpolation inside feather zone
  const hWeight = hDist <= hTol ? 1 : 1 - (hDist - hTol) / (hMax - hTol);
  const sWeight = sDist <= sTol ? 1 : 1 - (sDist - sTol) / (sMax - sTol);
  const lWeight = lDist <= lTol ? 1 : 1 - (lDist - lTol) / (lMax - lTol);

  return Math.max(0, Math.min(1, hWeight * sWeight * lWeight));
}

/**
 * Applies targeted Point Color adjustments to an image.
 */
export function applyPointColor(source: ImageData, options: PointColorOptions): ImageData {
  const output = createImageData(source.width, source.height);
  const src = source.data;
  const dst = output.data;

  const { target, range, adjustment = {}, visualizeRange = false } = options;
  const hueShift = adjustment.hueShift ?? 0;
  const satScale = adjustment.saturationScale ?? 1.0;
  const lumShift = adjustment.luminanceShift ?? 0.0;

  for (let i = 0; i < src.length; i += 4) {
    const r = src[i] ?? 0;
    const g = src[i + 1] ?? 0;
    const b = src[i + 2] ?? 0;
    const a = src[i + 3] ?? 255;

    const [h, s, l] = pointRgbToHsl(r, g, b);
    const weight = calculatePointColorWeight(h, s, l, target, range);

    if (visualizeRange) {
      if (weight > 0) {
        // Keep selected pixels colored, blended with any adjustment
        const newH = (h + hueShift * weight) % 360;
        const newS = Math.max(0, Math.min(1, s * (1 + (satScale - 1) * weight)));
        const newL = Math.max(0, Math.min(1, l + lumShift * weight));
        const [nr, ng, nb] = pointHslToRgb(newH, newS, newL);
        dst[i] = nr;
        dst[i + 1] = ng;
        dst[i + 2] = nb;
      } else {
        // Desaturate non-selected pixels to pure luminance
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        dst[i] = gray;
        dst[i + 1] = gray;
        dst[i + 2] = gray;
      }
    } else {
      if (weight > 0) {
        const newH = (h + hueShift * weight) % 360;
        const newS = Math.max(0, Math.min(1, s * (1 + (satScale - 1) * weight)));
        const newL = Math.max(0, Math.min(1, l + lumShift * weight));
        const [nr, ng, nb] = pointHslToRgb(newH, newS, newL);
        dst[i] = nr;
        dst[i + 1] = ng;
        dst[i + 2] = nb;
      } else {
        dst[i] = r;
        dst[i + 1] = g;
        dst[i + 2] = b;
      }
    }

    dst[i + 3] = a;
  }

  return output;
}
