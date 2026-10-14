/**
 * Lightroom-inspired Defringe & Chromatic Aberration Correction.
 *
 * Suppresses axial and lateral purple and green color fringing along
 * high-contrast backlit boundaries without affecting natural colors in the scene.
 */

import { pointRgbToHsl, pointHslToRgb } from "./point-color.js";

export interface DefringeOptions {
  /** Strength of purple fringe removal [0, 100] (default: 50). */
  purpleAmount?: number;
  /** Purple hue range in degrees [min, max] (default: [260, 330]). */
  purpleHueRange?: [number, number];
  /** Strength of green fringe removal [0, 100] (default: 50). */
  greenAmount?: number;
  /** Green hue range in degrees [min, max] (default: [90, 170]). */
  greenHueRange?: [number, number];
  /** Edge gradient detection sensitivity [0, 1] (default: 0.15). */
  edgeThreshold?: number;
}

function createImageData(width: number, height: number, data?: Uint8ClampedArray): ImageData {
  const pixelData = data ?? new Uint8ClampedArray(width * height * 4);
  if (typeof ImageData !== "undefined") {
    return new ImageData(pixelData as unknown as Uint8ClampedArray<ArrayBuffer>, width, height);
  }
  return { data: pixelData, width, height } as unknown as ImageData;
}

/**
 * Checks if a hue falls inside a given angular range [min, max].
 */
export function isHueInRange(hue: number, [min, max]: [number, number]): boolean {
  const h = (hue % 360 + 360) % 360;
  if (min <= max) {
    return h >= min && h <= max;
  }
  // Handles range wrapping around 360/0
  return h >= min || h <= max;
}

/**
 * Computes simple luminance gradient magnitude for edge detection.
 */
function computeEdgeGradient(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (x <= 0 || x >= width - 1 || y <= 0 || y >= height - 1) {
    return 0;
  }

  const idxLeft = (y * width + (x - 1)) * 4;
  const idxRight = (y * width + (x + 1)) * 4;
  const idxUp = ((y - 1) * width + x) * 4;
  const idxDown = ((y + 1) * width + x) * 4;

  const lumLeft = (0.299 * (data[idxLeft] ?? 0) + 0.587 * (data[idxLeft + 1] ?? 0) + 0.114 * (data[idxLeft + 2] ?? 0)) / 255;
  const lumRight = (0.299 * (data[idxRight] ?? 0) + 0.587 * (data[idxRight + 1] ?? 0) + 0.114 * (data[idxRight + 2] ?? 0)) / 255;
  const lumUp = (0.299 * (data[idxUp] ?? 0) + 0.587 * (data[idxUp + 1] ?? 0) + 0.114 * (data[idxUp + 2] ?? 0)) / 255;
  const lumDown = (0.299 * (data[idxDown] ?? 0) + 0.587 * (data[idxDown + 1] ?? 0) + 0.114 * (data[idxDown + 2] ?? 0)) / 255;

  const dx = lumRight - lumLeft;
  const dy = lumDown - lumUp;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Applies optical defringing to remove purple and green chromatic aberration along edges.
 */
export function applyDefringe(image: ImageData, options: DefringeOptions = {}): ImageData {
  const {
    purpleAmount = 50,
    purpleHueRange = [260, 330],
    greenAmount = 50,
    greenHueRange = [90, 170],
    edgeThreshold = 0.15,
  } = options;

  const purpleStrength = Math.max(0, Math.min(100, purpleAmount)) / 100;
  const greenStrength = Math.max(0, Math.min(100, greenAmount)) / 100;

  if (purpleStrength === 0 && greenStrength === 0) {
    // No-op
    const clone = new Uint8ClampedArray(image.data);
    return createImageData(image.width, image.height, clone);
  }

  const { width, height, data } = image;
  const output = createImageData(width, height);
  const outData = output.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx] ?? 0;
      const g = data[idx + 1] ?? 0;
      const b = data[idx + 2] ?? 0;
      const a = data[idx + 3] ?? 255;

      const [h, s, l] = pointRgbToHsl(r, g, b);
      const edgeGrad = computeEdgeGradient(data, width, height, x, y);

      let desatFactor = 0;

      // Only suppress fringing when close to a high-contrast boundary or high saturation edge
      if (edgeGrad >= edgeThreshold || s > 0.4) {
        if (purpleStrength > 0 && isHueInRange(h, purpleHueRange)) {
          desatFactor = purpleStrength;
        } else if (greenStrength > 0 && isHueInRange(h, greenHueRange)) {
          desatFactor = greenStrength;
        }
      }

      if (desatFactor > 0) {
        // Desaturate the fringing chromaticity towards neutral luminance
        const newS = Math.max(0, s * (1 - desatFactor));
        const [nr, ng, nb] = pointHslToRgb(h, newS, l);
        outData[idx] = nr;
        outData[idx + 1] = ng;
        outData[idx + 2] = nb;
      } else {
        outData[idx] = r;
        outData[idx + 1] = g;
        outData[idx + 2] = b;
      }
      outData[idx + 3] = a;
    }
  }

  return output;
}
