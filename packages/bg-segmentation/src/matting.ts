import type { Mask, RasterImage } from "@director/raster-tools";

export interface GuidedFilterOptions {
  /** Local filter window radius in pixels (default: 4) */
  radiusPx?: number;
  /** Regularization parameter controlling edge sensitivity (default: 1e-3) */
  eps?: number;
}

export interface MatteRefinementOptions {
  /** Guided filter window radius in pixels (default: 4) */
  radiusPx?: number;
  /** Regularization parameter (default: 1e-3) */
  eps?: number;
  /** Choke (negative, e.g. -1 to shrink boundary) or expand (positive, e.g. +1) in pixels (default: 0) */
  morphologyRadiusPx?: number;
  /** Edge curve gamma to sharpen (e.g. 1.2) or soften (e.g. 0.8) alpha transition (default: 1.0) */
  gamma?: number;
}

/**
 * Fast separable box blur for floating-point 2D planes.
 * Runtime is O(width * height) independent of radius via sliding-window running sums.
 */
function boxBlurFloat(
  input: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return new Float32Array(input);

  const horiz = new Float32Array(width * height);
  const out = new Float32Array(width * height);

  // 1. Horizontal pass
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    let windowSum = 0;
    const initialWindow = Math.min(r, width - 1);
    for (let x = 0; x <= initialWindow; x++) {
      windowSum += input[rowOffset + x]!;
    }

    for (let x = 0; x < width; x++) {
      const windowLen = Math.min(width - 1, x + r) - Math.max(0, x - r) + 1;
      horiz[rowOffset + x] = windowSum / windowLen;

      const addIdx = x + r + 1;
      const removeIdx = x - r;
      if (addIdx < width) windowSum += input[rowOffset + addIdx]!;
      if (removeIdx >= 0) windowSum -= input[rowOffset + removeIdx]!;
    }
  }

  // 2. Vertical pass
  for (let x = 0; x < width; x++) {
    let windowSum = 0;
    const initialWindow = Math.min(r, height - 1);
    for (let y = 0; y <= initialWindow; y++) {
      windowSum += horiz[y * width + x]!;
    }

    for (let y = 0; y < height; y++) {
      const windowLen = Math.min(height - 1, y + r) - Math.max(0, y - r) + 1;
      out[y * width + x] = windowSum / windowLen;

      const addIdx = y + r + 1;
      const removeIdx = y - r;
      if (addIdx < height) windowSum += horiz[addIdx * width + x]!;
      if (removeIdx >= 0) windowSum -= horiz[removeIdx * width + x]!;
    }
  }

  return out;
}

/**
 * Guided Filter alpha matting (He, Sun, Tang, TPAMI 2013).
 *
 * Uses the high-resolution RGB image as an edge-preserving guidance prior to
 * refine coarse neural segmentation boundaries, transferring hair strands, fur
 * contours, and subtle edge geometry into the matte without haloing.
 */
export function guidedFilterMatte(
  guide: RasterImage,
  matte: Mask,
  options: GuidedFilterOptions = {},
): Mask {
  if (guide.width !== matte.width || guide.height !== matte.height) {
    throw new Error(
      `Guide image dimensions (${guide.width}x${guide.height}) must match matte dimensions (${matte.width}x${matte.height})`,
    );
  }

  const { width, height } = guide;
  const radius = options.radiusPx ?? 4;
  const eps = options.eps ?? 1e-3;

  if (radius <= 0) {
    return {
      width,
      height,
      data: new Uint8ClampedArray(matte.data),
    };
  }

  const totalPixels = width * height;
  const I = new Float32Array(totalPixels);
  const p = new Float32Array(totalPixels);
  const Ip = new Float32Array(totalPixels);
  const II = new Float32Array(totalPixels);

  // Rec. 709 normalized luminance guidance [0, 1] and normalized matte [0, 1]
  for (let idx = 0; idx < totalPixels; idx++) {
    const rgbIdx = idx * 4;
    const luma =
      (0.2126 * guide.data[rgbIdx]! +
        0.7152 * guide.data[rgbIdx + 1]! +
        0.0722 * guide.data[rgbIdx + 2]!) /
      255;
    const alpha = matte.data[idx]! / 255;

    I[idx] = luma;
    p[idx] = alpha;
    Ip[idx] = luma * alpha;
    II[idx] = luma * luma;
  }

  const meanI = boxBlurFloat(I, width, height, radius);
  const meanP = boxBlurFloat(p, width, height, radius);
  const meanIp = boxBlurFloat(Ip, width, height, radius);
  const meanII = boxBlurFloat(II, width, height, radius);

  // a = cov(I, p) / (var(I) + eps)
  // b = meanP - a * meanI
  const a = new Float32Array(totalPixels);
  const b = new Float32Array(totalPixels);

  for (let idx = 0; idx < totalPixels; idx++) {
    const mi = meanI[idx]!;
    const mp = meanP[idx]!;
    const varI = meanII[idx]! - mi * mi;
    const covIp = meanIp[idx]! - mi * mp;

    const aVal = covIp / (varI + eps);
    const bVal = mp - aVal * mi;
    a[idx] = aVal;
    b[idx] = bVal;
  }

  const meanA = boxBlurFloat(a, width, height, radius);
  const meanB = boxBlurFloat(b, width, height, radius);

  // q = meanA * I + meanB
  const outData = new Uint8ClampedArray(totalPixels);
  for (let idx = 0; idx < totalPixels; idx++) {
    const q = meanA[idx]! * I[idx]! + meanB[idx]!;
    outData[idx] = Math.round(Math.max(0, Math.min(1, q)) * 255);
  }

  return { width, height, data: outData };
}

/**
 * Morphological dilation or erosion on an 8-bit mask.
 * - dilate: expands the selection boundary outward by radiusPx
 * - erode: shrinks the selection boundary inward (choking edges to eliminate fringe halos)
 */
export function morphologyMask(
  mask: Mask,
  radiusPx: number,
  mode: "dilate" | "erode",
): Mask {
  const r = Math.max(0, Math.round(radiusPx));
  if (r === 0) {
    return {
      width: mask.width,
      height: mask.height,
      data: new Uint8ClampedArray(mask.data),
    };
  }

  const { width, height } = mask;
  const isDilate = mode === "dilate";
  const horiz = new Uint8ClampedArray(width * height);
  const out = new Uint8ClampedArray(width * height);

  // Horizontal min/max pass
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      let extVal = isDilate ? 0 : 255;
      const xStart = Math.max(0, x - r);
      const xEnd = Math.min(width - 1, x + r);
      for (let nx = xStart; nx <= xEnd; nx++) {
        const val = mask.data[rowOffset + nx]!;
        if (isDilate) {
          if (val > extVal) extVal = val;
        } else {
          if (val < extVal) extVal = val;
        }
      }
      horiz[rowOffset + x] = extVal;
    }
  }

  // Vertical min/max pass
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let extVal = isDilate ? 0 : 255;
      const yStart = Math.max(0, y - r);
      const yEnd = Math.min(height - 1, y + r);
      for (let ny = yStart; ny <= yEnd; ny++) {
        const val = horiz[ny * width + x]!;
        if (isDilate) {
          if (val > extVal) extVal = val;
        } else {
          if (val < extVal) extVal = val;
        }
      }
      out[y * width + x] = extVal;
    }
  }

  return { width, height, data: out };
}

/**
 * High-level edge refinement pipeline combining guided filtering, edge contraction/expansion,
 * and edge gamma contrast tuning.
 */
export function refineMatteEdges(
  image: RasterImage,
  mask: Mask,
  options: MatteRefinementOptions = {},
): Mask {
  let refined = guidedFilterMatte(image, mask, {
    radiusPx: options.radiusPx ?? 4,
    eps: options.eps ?? 1e-3,
  });

  const morphRadius = options.morphologyRadiusPx ?? 0;
  if (morphRadius > 0) {
    refined = morphologyMask(refined, morphRadius, "dilate");
  } else if (morphRadius < 0) {
    refined = morphologyMask(refined, Math.abs(morphRadius), "erode");
  }

  const gamma = options.gamma ?? 1.0;
  if (gamma !== 1.0 && gamma > 0) {
    const outData = new Uint8ClampedArray(refined.data.length);
    for (let i = 0; i < refined.data.length; i++) {
      const norm = refined.data[i]! / 255;
      const adjusted = Math.pow(norm, gamma);
      outData[i] = Math.round(Math.max(0, Math.min(1, adjusted)) * 255);
    }
    refined = { width: refined.width, height: refined.height, data: outData };
  }

  return refined;
}

/**
 * Generate a 3-state Trimap from a segmentation mask.
 * - 0 = Definite background
 * - 128 = Unknown transition region (edge band)
 * - 255 = Definite foreground
 */
export function trimapFromMask(
  mask: Mask,
  fgThreshold = 240,
  bgThreshold = 15,
): {
  trimap: Mask;
  foregroundCount: number;
  backgroundCount: number;
  unknownCount: number;
} {
  const { width, height } = mask;
  const outData = new Uint8ClampedArray(width * height);
  let foregroundCount = 0;
  let backgroundCount = 0;
  let unknownCount = 0;

  for (let i = 0; i < mask.data.length; i++) {
    const val = mask.data[i]!;
    if (val >= fgThreshold) {
      outData[i] = 255;
      foregroundCount++;
    } else if (val <= bgThreshold) {
      outData[i] = 0;
      backgroundCount++;
    } else {
      outData[i] = 128;
      unknownCount++;
    }
  }

  return {
    trimap: { width, height, data: outData },
    foregroundCount,
    backgroundCount,
    unknownCount,
  };
}
