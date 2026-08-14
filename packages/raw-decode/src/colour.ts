import type { RgbImage } from "./demosaic.js";

/**
 * Getting a raw file's colours right.
 *
 * A demosaiced sensor image is not a picture yet. Its numbers are what *this
 * sensor* recorded through *its* filters, which differ between camera models —
 * feeding them to a display unchanged gives an image that is sharp, correctly
 * exposed, and the wrong colour. Two things fix that:
 *
 * **White balance.** `AsShotNeutral` says what the camera recorded for
 * something neutral under the scene's light. Dividing each channel by it makes
 * neutral read as neutral, which is what removes the orange cast of tungsten or
 * the blue of shade.
 *
 * **The colour matrix.** `ColorMatrix1/2` map XYZ onto this camera's response,
 * so the inverse maps the camera onto XYZ, from which sRGB is a fixed matrix.
 * Without it, colours are consistently off in a way that looks like a bad
 * white balance but cannot be fixed by adjusting one.
 */

export type Matrix3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/**
 * XYZ (D50) to linear sRGB, Bradford-adapted.
 *
 * D50 because that is the connection space DNG's colour matrices are defined
 * against; sRGB itself is D65, and the adaptation is baked into these numbers.
 * Using the unadapted D65 matrix instead leaves a slight warm cast on
 * everything, which is easy to mistake for a white-balance error.
 */
export const XYZ_D50_TO_SRGB: Matrix3 = [
  3.1338561, -1.6168667, -0.4906146, -0.9787684, 1.9161415, 0.033454, 0.0719453,
  -0.2289914, 1.4052427,
];

export function multiply3(a: Matrix3, b: Matrix3): Matrix3 {
  const out = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) sum += a[row * 3 + k]! * b[k * 3 + col]!;
      out[row * 3 + col] = sum;
    }
  }
  return out as unknown as Matrix3;
}

/**
 * Invert a 3×3 matrix, or null if it is singular.
 *
 * Null rather than a matrix full of Infinity: a singular colour matrix means
 * the file is describing something impossible, and every pixel becoming NaN
 * three stages later is a much harder thing to diagnose than a refusal here.
 */
export function invert3(m: Matrix3): Matrix3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  // Not `=== 0`: a near-singular matrix inverts to enormous values that are
  // finite and useless, so the threshold has to exclude those too.
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;

  const inv = 1 / det;
  return [
    A * inv,
    -(b * i - c * h) * inv,
    (b * f - c * e) * inv,
    B * inv,
    (a * i - c * g) * inv,
    -(a * f - c * d) * inv,
    C * inv,
    -(a * h - b * g) * inv,
    (a * e - b * d) * inv,
  ] as unknown as Matrix3;
}

export interface ColourTransform {
  /** Camera response to linear sRGB, white balance included. */
  matrix: Matrix3;
}

/**
 * Build the camera-to-sRGB transform.
 *
 * `colorMatrix` is DNG's XYZ→camera, so it is inverted here. `asShotNeutral` is
 * the camera's reading for a neutral subject, and dividing by it is the white
 * balance.
 *
 * The rows are then normalised so each sums to 1. That makes the transform map
 * neutral to neutral *exactly*, which matters because the alternative is a
 * residual tint that survives every later adjustment — the user would correct
 * it by eye on every photograph and never find the cause. It is also the one
 * property of this transform that can be asserted without a reference image.
 */
export function cameraToSrgb(
  colorMatrix: Matrix3,
  asShotNeutral?: readonly number[],
): ColourTransform | null {
  const xyzToCamera = colorMatrix;
  const cameraToXyz = invert3(xyzToCamera);
  if (cameraToXyz === null) return null;

  let m = multiply3(XYZ_D50_TO_SRGB, cameraToXyz);

  if (asShotNeutral && asShotNeutral.length === 3) {
    // Scale each camera channel by 1/neutral before the matrix. A zero or
    // negative neutral is a broken file; leaving that channel unscaled beats
    // dividing by it.
    const scaled = new Array<number>(9);
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const n = asShotNeutral[col]!;
        scaled[row * 3 + col] = m[row * 3 + col]! / (n > 0 ? n : 1);
      }
    }
    m = scaled as unknown as Matrix3;
  }

  const normalised = new Array<number>(9);
  for (let row = 0; row < 3; row += 1) {
    const sum = m[row * 3]! + m[row * 3 + 1]! + m[row * 3 + 2]!;
    // A row summing to zero cannot be normalised and would produce NaN. Passing
    // it through unchanged keeps the failure local and visible.
    const k = Math.abs(sum) > 1e-9 ? 1 / sum : 1;
    for (let col = 0; col < 3; col += 1) {
      normalised[row * 3 + col] = m[row * 3 + col]! * k;
    }
  }

  return { matrix: normalised as unknown as Matrix3 };
}

/**
 * Apply a colour transform in place of the sensor's own primaries.
 *
 * Values are clamped to 0..1 afterwards. A colour matrix routinely produces
 * negatives for saturated subjects — colours the sensor can distinguish but the
 * display cannot show — and letting those through makes the sRGB encoder return
 * NaN, which appears as black speckle in exactly the most colourful parts of
 * the frame.
 */
export function applyColourTransform(
  image: RgbImage,
  transform: ColourTransform,
): RgbImage {
  const m = transform.matrix;
  const out = new Float32Array(image.rgb.length);
  for (let p = 0; p < image.rgb.length; p += 3) {
    const r = image.rgb[p]!;
    const g = image.rgb[p + 1]!;
    const b = image.rgb[p + 2]!;
    for (let c = 0; c < 3; c += 1) {
      const v = m[c * 3]! * r + m[c * 3 + 1]! * g + m[c * 3 + 2]! * b;
      out[p + c] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  return { width: image.width, height: image.height, rgb: out };
}
