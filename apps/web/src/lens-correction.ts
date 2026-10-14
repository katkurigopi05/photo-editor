/**
 * Lightroom-inspired Physical Lens Distortion and Vignette Correction.
 *
 * Implements radial polynomial warp (barrel/pincushion correction) with bilinear
 * interpolation, and optical lens light-falloff vignette compensation.
 */

export interface LensCorrectionOptions {
  /**
   * Radial geometric distortion correction [-100, 100].
   * Positive corrects barrel distortion; negative corrects pincushion distortion.
   */
  distortion?: number;
  /**
   * Lens vignetting compensation [-100, 100].
   * Positive brightens darkened corners; negative darkens corners.
   */
  vignetteAmount?: number;
  /**
   * Midpoint radius for vignette falloff [0, 100] (default: 50).
   */
  vignetteMidpoint?: number;
}

function createImageData(width: number, height: number, data?: Uint8ClampedArray): ImageData {
  const pixelData = data ?? new Uint8ClampedArray(width * height * 4);
  if (typeof ImageData !== "undefined") {
    return new ImageData(pixelData as unknown as Uint8ClampedArray<ArrayBuffer>, width, height);
  }
  return { data: pixelData, width, height } as unknown as ImageData;
}

/**
 * Bilinear sampling from image data at continuous coordinates (x, y).
 */
function sampleBilinear(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const xClamped = Math.max(0, Math.min(width - 1, x));
  const yClamped = Math.max(0, Math.min(height - 1, y));

  const x0 = Math.floor(xClamped);
  const y0 = Math.floor(yClamped);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);

  const fx = xClamped - x0;
  const fy = yClamped - y0;

  const idx00 = (y0 * width + x0) * 4;
  const idx10 = (y0 * width + x1) * 4;
  const idx01 = (y1 * width + x0) * 4;
  const idx11 = (y1 * width + x1) * 4;

  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;

  const r = (data[idx00] ?? 0) * w00 + (data[idx10] ?? 0) * w10 + (data[idx01] ?? 0) * w01 + (data[idx11] ?? 0) * w11;
  const g = (data[idx00 + 1] ?? 0) * w00 + (data[idx10 + 1] ?? 0) * w10 + (data[idx01 + 1] ?? 0) * w01 + (data[idx11 + 1] ?? 0) * w11;
  const b = (data[idx00 + 2] ?? 0) * w00 + (data[idx10 + 2] ?? 0) * w10 + (data[idx01 + 2] ?? 0) * w01 + (data[idx11 + 2] ?? 0) * w11;
  const a = (data[idx00 + 3] ?? 0) * w00 + (data[idx10 + 3] ?? 0) * w10 + (data[idx01 + 3] ?? 0) * w01 + (data[idx11 + 3] ?? 0) * w11;

  return [Math.round(r), Math.round(g), Math.round(b), Math.round(a)];
}

/**
 * Applies geometric distortion and lens vignette compensation.
 */
export function applyLensCorrection(
  image: ImageData,
  options: LensCorrectionOptions = {},
): ImageData {
  const {
    distortion = 0,
    vignetteAmount = 0,
    vignetteMidpoint = 50,
  } = options;

  if (distortion === 0 && vignetteAmount === 0) {
    const copy = new Uint8ClampedArray(image.data);
    return createImageData(image.width, image.height, copy);
  }

  const { width, height, data } = image;
  const output = createImageData(width, height);
  const outData = output.data;

  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY);

  // Distortion parameter k: positive corrects barrel, negative corrects pincushion
  const k = (distortion / 100) * 0.25;

  // Vignette parameters
  const vigGain = vignetteAmount / 100;
  const midNorm = Math.max(0.1, Math.min(1.0, vignetteMidpoint / 100));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const outIdx = (y * width + x) * 4;

      // 1. Geometric Distortion Inverse Mapping
      let srcX = x;
      let srcY = y;

      if (k !== 0) {
        const dx = (x - centerX) / centerX;
        const dy = (y - centerY) / centerY;
        const r2 = dx * dx + dy * dy;
        const factor = 1 + k * r2;

        srcX = centerX + dx * factor * centerX;
        srcY = centerY + dy * factor * centerY;
      }

      // Sample source pixel with bilinear interpolation
      const [r, g, b, a] = sampleBilinear(data, width, height, srcX, srcY);

      // 2. Optical Lens Vignette Compensation
      let finalR = r;
      let finalG = g;
      let finalB = b;

      if (vigGain !== 0) {
        const rx = x - centerX;
        const ry = y - centerY;
        const dist = Math.sqrt(rx * rx + ry * ry);
        const normDist = Math.min(1.0, dist / maxRadius);

        // Smooth cosine-like falloff curve anchored at midpoint
        const falloff = Math.pow(normDist, 2.0 / midNorm);
        const mult = 1.0 + vigGain * falloff;

        finalR = Math.max(0, Math.min(255, Math.round(r * mult)));
        finalG = Math.max(0, Math.min(255, Math.round(g * mult)));
        finalB = Math.max(0, Math.min(255, Math.round(b * mult)));
      }

      outData[outIdx] = finalR;
      outData[outIdx + 1] = finalG;
      outData[outIdx + 2] = finalB;
      outData[outIdx + 3] = a;
    }
  }

  return output;
}
