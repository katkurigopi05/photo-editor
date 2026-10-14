/**
 * Lightroom-inspired AI Lens Blur and Aperture Bokeh Simulator.
 *
 * Simulates shallow depth of field, optical aperture bokeh discs
 * (circular, multi-blade polygon, cat-eye), and specular highlight boost.
 */

export type BokehShape = "circle" | "blade-5" | "blade-7" | "blade-9" | "cat-eye";

export interface LensBlurOptions {
  /** Maximum blur radius in pixels [0, 100] (default: 20). */
  blurAmount?: number;
  /** In-focus depth plane range [near, far] normalized to [0, 1] (default: [0.4, 0.6]). */
  focalRange?: [number, number];
  /** Shape of aperture opening (default: "circle"). */
  bokehShape?: BokehShape;
  /** Specular highlight boost [0, 100] (default: 30). */
  bokehBoost?: number;
  /** Specular threshold [0, 255] above which pixels receive bokeh boost (default: 200). */
  specularThreshold?: number;
}

function createImageData(width: number, height: number, data?: Uint8ClampedArray): ImageData {
  const pixelData = data ?? new Uint8ClampedArray(width * height * 4);
  if (typeof ImageData !== "undefined") {
    return new ImageData(pixelData as unknown as Uint8ClampedArray<ArrayBuffer>, width, height);
  }
  return { data: pixelData, width, height } as unknown as ImageData;
}

/**
 * Checks if a relative coordinate (dx, dy) normalized to [-1, 1] is within the aperture shape.
 */
function isInsideAperture(dx: number, dy: number, shape: BokehShape): boolean {
  const r2 = dx * dx + dy * dy;
  if (r2 > 1.0) return false;

  if (shape === "circle") return true;

  if (shape === "cat-eye") {
    // Optical vignetting / cat-eye elliptical pinch
    return (dx * dx) / 0.5 + (dy * dy) / 1.0 <= 1.0;
  }

  // Multi-blade polygonal aperture: r(theta) <= cos(pi/N) / cos(theta - 2pi/N * floor((N*theta + pi)/(2pi)))
  let blades = 5;
  if (shape === "blade-7") blades = 7;
  if (shape === "blade-9") blades = 9;

  const angle = Math.atan2(dy, dx);
  const sector = (2 * Math.PI) / blades;
  const modAngle = ((angle % sector) + sector) % sector - sector / 2;
  const maxR = Math.cos(Math.PI / blades) / Math.cos(modAngle);

  return Math.sqrt(r2) <= maxR;
}

/**
 * Generates sampling offsets and weights for a given bokeh aperture shape.
 */
function generateBokehOffsets(radius: number, shape: BokehShape): Array<{ dx: number; dy: number; weight: number }> {
  const offsets: Array<{ dx: number; dy: number; weight: number }> = [];
  const rInt = Math.ceil(radius);

  for (let dy = -rInt; dy <= rInt; dy++) {
    for (let dx = -rInt; dx <= rInt; dx++) {
      const normX = dx / radius;
      const normY = dy / radius;

      if (isInsideAperture(normX, normY, shape)) {
        offsets.push({ dx, dy, weight: 1.0 });
      }
    }
  }

  if (offsets.length === 0) {
    offsets.push({ dx: 0, dy: 0, weight: 1.0 });
  }

  return offsets;
}

/**
 * Applies optical lens blur with depth map and aperture bokeh simulation.
 */
export function applyLensBlur(
  image: ImageData,
  options: LensBlurOptions = {},
  depthMap?: ImageData,
): ImageData {
  const {
    blurAmount = 20,
    focalRange = [0.4, 0.6],
    bokehShape = "circle",
    bokehBoost = 30,
    specularThreshold = 200,
  } = options;

  if (blurAmount <= 0) {
    const copy = new Uint8ClampedArray(image.data);
    return createImageData(image.width, image.height, copy);
  }

  const { width, height, data } = image;
  const output = createImageData(width, height);
  const outData = output.data;

  const [focalNear, focalFar] = focalRange;
  const boostGain = 1.0 + (bokehBoost / 100) * 1.5;

  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const maxDist = Math.max(1, Math.sqrt(cx * cx + cy * cy));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      // Determine pixel depth [0, 1]
      let depth = 0.5;
      if (depthMap && depthMap.data.length === data.length) {
        depth = (depthMap.data[idx] ?? 128) / 255;
      } else {
        // Fallback: natural radial depth field (center subject in focus, outer background blurred)
        const rx = x - cx;
        const ry = y - cy;
        const distNorm = Math.sqrt(rx * rx + ry * ry) / maxDist;
        depth = 0.5 + distNorm * 0.5;
      }

      // Compute circle of confusion (CoC) radius
      let coc = 0;
      if (depth < focalNear) {
        coc = (focalNear - depth) / Math.max(0.01, focalNear);
      } else if (depth > focalFar) {
        coc = (depth - focalFar) / Math.max(0.01, 1.0 - focalFar);
      }
      coc = Math.max(0, Math.min(1.0, coc));

      const pixelBlurRadius = coc * blurAmount;

      if (pixelBlurRadius < 0.5) {
        // In-focus pixel, copy straight
        outData[idx] = data[idx] ?? 0;
        outData[idx + 1] = data[idx + 1] ?? 0;
        outData[idx + 2] = data[idx + 2] ?? 0;
        outData[idx + 3] = data[idx + 3] ?? 255;
        continue;
      }

      // Convolve with bokeh aperture kernel
      const offsets = generateBokehOffsets(pixelBlurRadius, bokehShape);

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let totalWeight = 0;

      for (const { dx, dy } of offsets) {
        const sx = Math.max(0, Math.min(width - 1, x + dx));
        const sy = Math.max(0, Math.min(height - 1, y + dy));
        const sIdx = (sy * width + sx) * 4;

        const sr = data[sIdx] ?? 0;
        const sg = data[sIdx + 1] ?? 0;
        const sb = data[sIdx + 2] ?? 0;

        // Specular highlight boost: bright spots create defined bokeh balls
        const luma = 0.299 * sr + 0.587 * sg + 0.114 * sb;
        const weight = luma > specularThreshold ? boostGain : 1.0;

        sumR += sr * weight;
        sumG += sg * weight;
        sumB += sb * weight;
        totalWeight += weight;
      }

      outData[idx] = Math.max(0, Math.min(255, Math.round(sumR / totalWeight)));
      outData[idx + 1] = Math.max(0, Math.min(255, Math.round(sumG / totalWeight)));
      outData[idx + 2] = Math.max(0, Math.min(255, Math.round(sumB / totalWeight)));
      outData[idx + 3] = data[idx + 3] ?? 255;
    }
  }

  return output;
}
