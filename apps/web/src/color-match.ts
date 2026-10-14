/**
 * AI Color Match Engine.
 *
 * Implements CapCut-style automated color harmonization between clips.
 * Extracts perceptual color statistics from a reference image/clip and
 * transfers tonal distribution, contrast, and color balance to a target image.
 */

export interface ChannelStats {
  mean: number;
  stdDev: number;
}

export interface ImageColorStats {
  r: ChannelStats;
  g: ChannelStats;
  b: ChannelStats;
  averageLuminance: number;
}

export interface ColorMatchOptions {
  /** Match intensity [0..1], 1.0 is full transfer, 0.0 is unchanged. */
  intensity?: number | undefined;
  /** Whether to match exposure / luminance. */
  matchLuminance?: boolean | undefined;
}

/**
 * Computes mean and standard deviation per RGB channel from ImageData.
 */
export function computeImageColorStats(data: ImageData): ImageColorStats {
  const pixels = data.data;
  const count = pixels.length / 4;
  if (count === 0) {
    const zero = { mean: 0, stdDev: 0 };
    return { r: zero, g: zero, b: zero, averageLuminance: 0 };
  }

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    sumR += pixels[i] ?? 0;
    sumG += pixels[i + 1] ?? 0;
    sumB += pixels[i + 2] ?? 0;
  }

  const meanR = sumR / count;
  const meanG = sumG / count;
  const meanB = sumB / count;

  let sqDiffR = 0;
  let sqDiffG = 0;
  let sqDiffB = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const diffR = (pixels[i] ?? 0) - meanR;
    const diffG = (pixels[i + 1] ?? 0) - meanG;
    const diffB = (pixels[i + 2] ?? 0) - meanB;
    sqDiffR += diffR * diffR;
    sqDiffG += diffG * diffG;
    sqDiffB += diffB * diffB;
  }

  const stdDevR = Math.sqrt(sqDiffR / count);
  const stdDevG = Math.sqrt(sqDiffG / count);
  const stdDevB = Math.sqrt(sqDiffB / count);

  const avgLum = 0.2126 * meanR + 0.7152 * meanG + 0.0722 * meanB;

  return {
    r: { mean: meanR, stdDev: Math.max(0.001, stdDevR) },
    g: { mean: meanG, stdDev: Math.max(0.001, stdDevG) },
    b: { mean: meanB, stdDev: Math.max(0.001, stdDevB) },
    averageLuminance: Math.round(avgLum * 10) / 10,
  };
}

function createImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): ImageData {
  if (typeof ImageData !== "undefined") {
    return new ImageData(
      data as unknown as Uint8ClampedArray<ArrayBuffer>,
      width,
      height,
    );
  }
  return { data, width, height } as unknown as ImageData;
}

/**
 * Transfers color distribution from a reference frame to a target frame.
 * Returns a new ImageData containing the color-matched pixels.
 */
export function applyColorMatch(
  targetData: ImageData,
  referenceStats: ImageColorStats,
  options: ColorMatchOptions = {},
): ImageData {
  const intensity = Math.max(0, Math.min(1, options.intensity ?? 1.0));
  const targetStats = computeImageColorStats(targetData);

  const matched = createImageData(
    new Uint8ClampedArray(targetData.data),
    targetData.width,
    targetData.height,
  );
  const pixels = matched.data;

  // Transfer scale factors: sigma_ref / sigma_target
  const scaleR = referenceStats.r.stdDev / targetStats.r.stdDev;
  const scaleG = referenceStats.g.stdDev / targetStats.g.stdDev;
  const scaleB = referenceStats.b.stdDev / targetStats.b.stdDev;

  for (let i = 0; i < pixels.length; i += 4) {
    const origR = pixels[i] ?? 0;
    const origG = pixels[i + 1] ?? 0;
    const origB = pixels[i + 2] ?? 0;

    // Reinhard normalized shift
    const newR = (origR - targetStats.r.mean) * scaleR + referenceStats.r.mean;
    const newG = (origG - targetStats.g.mean) * scaleG + referenceStats.g.mean;
    const newB = (origB - targetStats.b.mean) * scaleB + referenceStats.b.mean;

    // Blend with original by intensity
    pixels[i] = Math.round(origR + (newR - origR) * intensity);
    pixels[i + 1] = Math.round(origG + (newG - origG) * intensity);
    pixels[i + 2] = Math.round(origB + (newB - origB) * intensity);
    // Alpha channel pixels[i + 3] remains untouched
  }

  return matched;
}
