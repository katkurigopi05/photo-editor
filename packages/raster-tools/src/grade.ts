import { cloneImage, type RasterImage } from "./types.js";

/**
 * Colour grading.
 *
 * Three independent passes — white balance, levels, tone curve — that a
 * photographer expects to find under different names in every editor. Vibrance
 * belongs to the same family but lives in `adjust.ts`, whose mask-aware version
 * supersedes the one this module used to carry. They
 * are pure and deterministic, like the painterly passes, because they run
 * inside the shared draw path: the preview, the still export, every GIF frame
 * and every MP4 frame must grade a given source pixel to the same output byte.
 *
 * All three are per-channel point operations, so they are built as
 * 256-entry lookup tables and then applied — the cost is a table build plus one
 * array read per channel, independent of image size or parameter magnitude.
 *
 * Alpha is never touched, so a graded clip still keys out against a removed
 * background.
 */

/** Apply three per-channel lookup tables, leaving alpha alone. */
function applyLuts(
  image: RasterImage,
  red: Uint8ClampedArray,
  green: Uint8ClampedArray,
  blue: Uint8ClampedArray,
): RasterImage {
  const out = cloneImage(image);
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = red[image.data[i]!]!;
    out.data[i + 1] = green[image.data[i + 1]!]!;
    out.data[i + 2] = blue[image.data[i + 2]!]!;
  }
  return out;
}

function identityLut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = v;
  return lut;
}

/** Build a lookup table from a normalized 0..1 transfer function. */
function lutFrom(transfer: (value: number) => number): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    lut[v] = Math.round(clamp01(transfer(v / 255)) * 255);
  }
  return lut;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * White balance as a per-channel gain.
 *
 * `temperature` runs cool (-1, blue) to warm (+1, amber) on the red/blue axis;
 * `tint` runs magenta (-1) to green (+1) on the green axis with the
 * complementary channels moving the other way, which is the pairing every
 * camera and raw developer uses. Gains rather than offsets, so black stays
 * black and the correction scales with the light in the pixel instead of
 * washing the shadows.
 */
export function whiteBalance(
  image: RasterImage,
  temperature: number,
  tint: number,
): RasterImage {
  // A full-scale move is a 30% gain: enough to fix a badly lit frame, not
  // enough to clip a correctly lit one at the extreme of the slider.
  const MAX_GAIN = 0.3;
  const t = temperature * MAX_GAIN;
  const g = tint * MAX_GAIN;

  const redGain = 1 + t - g / 2;
  const greenGain = 1 + g;
  const blueGain = 1 - t - g / 2;

  return applyLuts(
    image,
    lutFrom((v) => v * redGain),
    lutFrom((v) => v * greenGain),
    lutFrom((v) => v * blueGain),
  );
}

/**
 * Black point / white point / gamma, the classic levels control.
 *
 * `blackPoint` and `whitePoint` are normalized input positions: everything at
 * or below the black point becomes 0, everything at or above the white point
 * becomes 255, and the window between them is stretched across the full range.
 * `gamma` above 1 lifts midtones, below 1 darkens them, with both endpoints
 * pinned.
 */
export function levels(
  image: RasterImage,
  blackPoint: number,
  whitePoint: number,
  gamma: number,
): RasterImage {
  const span = whitePoint - blackPoint;
  const exponent = gamma > 0 ? 1 / gamma : 1;
  const lut = lutFrom((v) => {
    // A degenerate or inverted window would divide by zero or flip the image;
    // the schema forbids it, and here it degrades to a hard threshold rather
    // than producing NaN.
    if (span <= 0) return v >= whitePoint ? 1 : 0;
    const normalized = clamp01((v - blackPoint) / span);
    return Math.pow(normalized, exponent);
  });
  return applyLuts(image, lut, lut, lut);
}

/**
 * Three-band tone curve: shadows, midtones, highlights.
 *
 * Each band is a Gaussian-weighted lift centred on its part of the range, so a
 * shadow lift leaves highlights nearly untouched and vice versa — the reason to
 * reach for a curve rather than a brightness slider. The lift is applied
 * against the headroom remaining in the direction of travel, which keeps the
 * result inside 0..1 and keeps the curve monotonic: tonal order can compress
 * but never inverts.
 */
export function toneCurve(
  image: RasterImage,
  shadows: number,
  midtones: number,
  highlights: number,
): RasterImage {
  // Band centres and a width wide enough that the three overlap smoothly
  // instead of banding at the seams.
  const BANDS: readonly [number, number][] = [
    [0.15, shadows],
    [0.5, midtones],
    [0.85, highlights],
  ];
  const WIDTH = 0.3;
  // Each band can move its centre by at most this much, so all three at full
  // travel cannot stack into a solid black or white frame.
  const MAX_LIFT = 0.35;

  const lut = lutFrom((v) => {
    let result = v;
    for (const [centre, amount] of BANDS) {
      if (amount === 0) continue;
      const distance = (v - centre) / WIDTH;
      const weight = Math.exp(-0.5 * distance * distance);
      const lift = amount * MAX_LIFT * weight;
      // Scale by the headroom left in the direction of travel: near white a
      // positive lift does almost nothing, near black a negative one likewise.
      result += lift > 0 ? lift * (1 - result) : lift * result;
    }
    return result;
  });
  return applyLuts(image, lut, lut, lut);
}

/** Exported for callers that want a neutral table to compose against. */
export { identityLut };
