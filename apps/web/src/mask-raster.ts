import {
  brushStrokeMask,
  colorRangeMask,
  composeMasks,
  linearGradientMask,
  luminanceRangeMask,
  radialGradientMask,
  createMask,
  type Mask,
  type RasterImage,
} from "@director/raster-tools";
import type { ClipMask, MaskContribution } from "@director/project-schema";

/**
 * Turning a stored mask into pixels.
 *
 * Masks are stored as normalized geometry (see `packages/project-schema/src/
 * masks.ts`), so this is where they meet a specific frame size — once per
 * (mask, size), never per adjustment. Keeping the conversion in one function is
 * what makes a mask cover the same region in a 640px preview and a 4K export:
 * there is only one place the multiplication by width and height happens.
 */

/**
 * A normalized coordinate to a pixel centre.
 *
 * Scaled by `size - 1`, not by `size`: 1.0 has to land on the last pixel, not
 * one past it, or a gradient spanning the whole frame never quite reaches full
 * coverage at the edge it was drawn to.
 */
function toPixel(value: number, size: number): number {
  return value * Math.max(0, size - 1);
}

/** Brush radius is a fraction of the frame's smaller side, so a stroke keeps
 * its thickness relative to the picture rather than to the wider axis. */
function brushRadiusPx(radius: number, width: number, height: number): number {
  return radius * Math.min(width, height);
}

function contributionMask(
  contribution: MaskContribution,
  image: RasterImage,
): Mask {
  const { width, height } = image;
  switch (contribution.kind) {
    case "linear":
      return linearGradientMask(
        width,
        height,
        {
          x: toPixel(contribution.from.x, width),
          y: toPixel(contribution.from.y, height),
        },
        {
          x: toPixel(contribution.to.x, width),
          y: toPixel(contribution.to.y, height),
        },
      );
    case "radial":
      return radialGradientMask(
        width,
        height,
        {
          x: toPixel(contribution.centre.x, width),
          y: toPixel(contribution.centre.y, height),
        },
        {
          x: contribution.radius.x * width,
          y: contribution.radius.y * height,
        },
        contribution.feather,
        contribution.invert,
      );
    case "brush":
      return brushStrokeMask(
        width,
        height,
        contribution.points.map((point) => ({
          x: toPixel(point.x, width),
          y: toPixel(point.y, height),
        })),
        brushRadiusPx(contribution.radius, width, height),
        contribution.feather,
      );
    case "luminance_range":
      return luminanceRangeMask(
        image,
        contribution.min,
        contribution.max,
        contribution.feather,
      );
    case "color_range": {
      const hex = contribution.colorHex;
      return colorRangeMask(
        image,
        {
          r: parseInt(hex.slice(1, 3), 16),
          g: parseInt(hex.slice(3, 5), 16),
          b: parseInt(hex.slice(5, 7), 16),
        },
        contribution.tolerance,
        contribution.feather,
      );
    }
  }
}

/** Rasterize a stored mask against a frame, composing its contributions in
 * order. Range contributions read the frame's own pixels, which is why the
 * image is passed rather than only its dimensions. */
export function rasterizeClipMask(mask: ClipMask, image: RasterImage): Mask {
  if (mask.contributions.length === 0) {
    return createMask(image.width, image.height);
  }
  return composeMasks(
    image.width,
    image.height,
    mask.contributions.map((contribution) => ({
      mask: contributionMask(contribution, image),
      mode: contribution.mode,
    })),
  );
}

/**
 * Blend an adjusted frame back over the original through a mask.
 *
 * Doing the confinement here rather than inside each adjustment means *every*
 * effect can be masked — including the painterly and grading passes, which take
 * no mask argument of their own — and that they all feather identically.
 */
export function blendThroughMask(
  original: RasterImage,
  adjusted: RasterImage,
  mask: Mask,
): RasterImage {
  const out: RasterImage = {
    width: original.width,
    height: original.height,
    data: new Uint8ClampedArray(original.data),
  };
  for (let p = 0, i = 0; i < out.data.length; i += 4, p++) {
    const cover = (mask.data[p] ?? 0) / 255;
    if (cover === 0) continue;
    if (cover === 1) {
      out.data[i] = adjusted.data[i]!;
      out.data[i + 1] = adjusted.data[i + 1]!;
      out.data[i + 2] = adjusted.data[i + 2]!;
      out.data[i + 3] = adjusted.data[i + 3]!;
      continue;
    }
    for (let c = 0; c < 4; c++) {
      const from = original.data[i + c]!;
      out.data[i + c] = Math.round(
        from + (adjusted.data[i + c]! - from) * cover,
      );
    }
  }
  return out;
}
