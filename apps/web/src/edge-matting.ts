import type { Mask, RasterImage } from "@director/raster-tools";
import {
  guidedFilterMatte,
  morphologyMask,
  refineMatteEdges,
  trimapFromMask,
  type GuidedFilterOptions,
  type MatteRefinementOptions,
} from "@director/bg-segmentation";

/**
 * High-performance edge refinement and alpha matting pipeline for browser-native
 * foreground segmentation.
 *
 * Transfers delicate boundary detail (fine hair, animal fur, clothing weave, whiskers)
 * from the source image into coarse neural network segmentations, eliminating boundary
 * step artifacts and haloing.
 */
export function refineEdgeMatte(
  image: RasterImage,
  mask: Mask,
  options: MatteRefinementOptions = {},
): Mask {
  return refineMatteEdges(image, mask, options);
}

/**
 * Choke (erode) matte boundary inward by N pixels to eliminate background fringe color cast.
 */
export function chokeMatte(mask: Mask, pixels = 1): Mask {
  return morphologyMask(mask, Math.max(1, Math.round(pixels)), "erode");
}

/**
 * Expand (dilate) matte boundary outward by N pixels to recover clipped boundary edges.
 */
export function expandMatte(mask: Mask, pixels = 1): Mask {
  return morphologyMask(mask, Math.max(1, Math.round(pixels)), "dilate");
}

/**
 * Generate a 3-state Trimap (0 = background, 128 = unknown edge band, 255 = foreground)
 * from an alpha segmentation mask.
 */
export function generateTrimap(
  mask: Mask,
  fgThreshold = 240,
  bgThreshold = 15,
): {
  trimap: Mask;
  foregroundCount: number;
  backgroundCount: number;
  unknownCount: number;
} {
  return trimapFromMask(mask, fgThreshold, bgThreshold);
}

/**
 * Compute edge sharpness and coverage statistics across the boundary transition.
 */
export function computeMattingQualityMetrics(
  originalImage: RasterImage,
  mask: Mask,
): {
  coverageFraction: number;
  edgeGradientMean: number;
  foregroundPixels: number;
  backgroundPixels: number;
} {
  const total = mask.width * mask.height;
  let fgCount = 0;
  let bgCount = 0;
  let gradientSum = 0;
  let edgePixelCount = 0;

  for (let y = 1; y < mask.height - 1; y++) {
    const rowOffset = y * mask.width;
    for (let x = 1; x < mask.width - 1; x++) {
      const idx = rowOffset + x;
      const alpha = mask.data[idx]!;

      if (alpha > 200) fgCount++;
      else if (alpha < 50) bgCount++;

      // In the transition boundary zone, compute spatial alpha gradient
      if (alpha > 10 && alpha < 245) {
        const dx = Math.abs(mask.data[idx + 1]! - mask.data[idx - 1]!) / 2;
        const dy =
          Math.abs(mask.data[idx + mask.width]! - mask.data[idx - mask.width]!) / 2;
        gradientSum += Math.hypot(dx, dy);
        edgePixelCount++;
      }
    }
  }

  return {
    coverageFraction: total > 0 ? Number((fgCount / total).toFixed(4)) : 0,
    edgeGradientMean:
      edgePixelCount > 0 ? Number((gradientSum / edgePixelCount).toFixed(2)) : 0,
    foregroundPixels: fgCount,
    backgroundPixels: bgCount,
  };
}

export {
  guidedFilterMatte,
  morphologyMask,
  refineMatteEdges,
  trimapFromMask,
  type GuidedFilterOptions,
  type MatteRefinementOptions,
};
