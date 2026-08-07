import { boxBlurRgb } from "./filters.js";
import { cloneImage, type Mask, type RasterImage } from "./types.js";

/**
 * Lightroom's Effects and Detail panels: Clarity, Texture, Dehaze, and noise
 * reduction split into luminance and colour.
 *
 * Three of the four are the same idea at different scales — compare a pixel
 * with a blurred copy of its surroundings, then push away from that average
 * (add local contrast) or toward it (smooth). What separates the controls is
 * the radius and what the difference is applied to:
 *
 * - **Texture** works at a 1px radius, so it bites on grain and fine detail.
 * - **Clarity** works at a wider radius, so it shapes midtone form without
 *   touching grain — which is why an editor reaches for one and not the other.
 * - **Luminance noise reduction** is the same comparison run backwards, and
 *   **colour noise reduction** smooths only the chroma difference, because the
 *   eye reads colour at far lower resolution than brightness.
 *
 * Dehaze is not a local-contrast control at all: haze compresses a scene into a
 * narrow, bright, low-saturation band, so removing it is a global stretch of
 * that band back across the range.
 *
 * Everything here is pure, mask-aware, and leaves alpha untouched — the same
 * contract as `adjust.ts`.
 */

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Coverage of `mask` at pixel index `p`, as 0…1; no mask means fully covered. */
function coverage(mask: Mask | undefined, p: number): number {
  if (!mask) return 1;
  return (mask.data[p] ?? 0) / 255;
}

function requireMatchingMask(image: RasterImage, mask: Mask | undefined): void {
  if (mask && (mask.width !== image.width || mask.height !== image.height)) {
    throw new Error(
      `mask ${mask.width}x${mask.height} does not match image ${image.width}x${image.height}`,
    );
  }
}

/**
 * Push each pixel away from (or toward) a band of detail extracted by two
 * blurs: everything finer than `outerRadiusPx` and coarser than
 * `innerRadiusPx`.
 *
 * The inner blur is what separates Clarity from Texture. A plain
 * original-minus-blur high-pass amplifies *everything* finer than its radius,
 * so a wide radius would crunch grain harder than a narrow one — the opposite
 * of what Clarity is for. Removing the finest octave first leaves Clarity
 * shaping midtone form while Texture, whose inner radius is zero, keeps the
 * grain it is meant to work on.
 *
 * `amount` is Lightroom's −100…+100: positive adds local contrast, negative
 * smooths. A flat region has no detail in the band, so it stays flat.
 */
function bandContrast(
  image: RasterImage,
  amount: number,
  innerRadiusPx: number,
  outerRadiusPx: number,
  mask: Mask | undefined,
): RasterImage {
  requireMatchingMask(image, mask);
  const out = cloneImage(image);
  if (amount === 0) return out;

  const strength = amount / 100;
  const fine = innerRadiusPx > 0 ? boxBlurRgb(image, innerRadiusPx) : image;
  const coarse = boxBlurRgb(image, outerRadiusPx);
  for (let p = 0, i = 0; i < image.data.length; i += 4, p++) {
    const cover = coverage(mask, p);
    if (cover === 0) continue;
    for (let c = 0; c < 3; c++) {
      const original = image.data[i + c]!;
      const detail = fine.data[i + c]! - coarse.data[i + c]!;
      const adjusted = original + detail * strength;
      out.data[i + c] = clamp255(original + (adjusted - original) * cover);
    }
  }
  return out;
}

/** Midtone form: the band between 1px and 4px, so grain is left alone
 * (−100…+100). */
export function clarity(
  image: RasterImage,
  amount: number,
  mask?: Mask,
): RasterImage {
  return bandContrast(image, amount, 1, 4, mask);
}

/** Fine detail: everything finer than 1px (−100…+100). */
export function texture(
  image: RasterImage,
  amount: number,
  mask?: Mask,
): RasterImage {
  return bandContrast(image, amount, 0, 1, mask);
}

/**
 * Dehaze (−100…+100).
 *
 * Positive stretches the frame's occupied tonal band back across the full
 * range and restores the saturation haze washes out; negative compresses
 * toward the haze point to add atmosphere. The band is measured from the image
 * itself rather than assumed, so a correctly exposed frame is barely touched by
 * a positive value — there is no haze to remove.
 */
export function dehaze(
  image: RasterImage,
  amount: number,
  mask?: Mask,
): RasterImage {
  requireMatchingMask(image, mask);
  const out = cloneImage(image);
  if (amount === 0) return out;

  const strength = amount / 100;

  // The occupied luminance band, ignoring the extreme tails so a single
  // blown pixel cannot decide the stretch.
  const histogram = new Uint32Array(256);
  let counted = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const value = Math.round(
      LUMA_R * image.data[i]! +
        LUMA_G * image.data[i + 1]! +
        LUMA_B * image.data[i + 2]!,
    );
    histogram[Math.min(255, Math.max(0, value))]! += 1;
    counted++;
  }
  const tail = Math.max(1, Math.floor(counted * 0.01));
  let low = 0;
  let high = 255;
  for (let seen = 0, v = 0; v < 256; v++) {
    seen += histogram[v]!;
    if (seen >= tail) {
      low = v;
      break;
    }
  }
  for (let seen = 0, v = 255; v >= 0; v--) {
    seen += histogram[v]!;
    if (seen >= tail) {
      high = v;
      break;
    }
  }
  const span = Math.max(1, high - low);
  // How far to pull the band toward the full range, in proportion to how
  // compressed it already is.
  const stretch = 255 / span;

  for (let p = 0, i = 0; i < image.data.length; i += 4, p++) {
    const cover = coverage(mask, p);
    if (cover === 0) continue;
    const r = image.data[i]!;
    const g = image.data[i + 1]!;
    const b = image.data[i + 2]!;
    const grey = LUMA_R * r + LUMA_G * g + LUMA_B * b;

    // Clearing haze stretches the occupied band back across the range; adding
    // it lifts everything toward the bright end instead. Saturation moves with
    // the contrast either way, because haze removes colour as well as contrast
    // — putting one back without the other reads as a levels adjustment rather
    // than as clearing air.
    const newGrey =
      strength > 0
        ? grey + ((grey - low) * stretch - grey) * strength
        : grey + (high - grey) * -strength * 0.35;
    const satScale = 1 + strength * 0.5;
    for (let c = 0; c < 3; c++) {
      const original = image.data[i + c]!;
      const adjusted = newGrey + (original - grey) * satScale;
      out.data[i + c] = clamp255(original + (adjusted - original) * cover);
    }
  }
  return out;
}

/**
 * Noise reduction, split the way Lightroom splits it (both 0…100).
 *
 * `luminanceAmount` smooths brightness noise, which costs real detail and so is
 * applied gently. `colorAmount` smooths only the chroma difference from the
 * pixel's own luminance, which can be pushed much harder: a colour speckle
 * disappears while the luminance structure it sat on is left exactly as it was.
 */
export function noiseReduction(
  image: RasterImage,
  luminanceAmount: number,
  colorAmount: number,
  mask?: Mask,
): RasterImage {
  requireMatchingMask(image, mask);
  const out = cloneImage(image);
  const lum = Math.max(0, Math.min(100, luminanceAmount)) / 100;
  const chroma = Math.max(0, Math.min(100, colorAmount)) / 100;
  if (lum === 0 && chroma === 0) return out;

  // Strength widens the neighbourhood rather than only weighting it: a fixed
  // one-pixel radius at 100 is barely visible on real grain, which is the
  // difference between a control that works and one that only looks applied.
  // Chroma reaches wider than luminance because colour blotches are larger and
  // the eye cannot see the resolution loss.
  const radius = Math.max(1, Math.round(1 + lum * 2 + chroma * 3));
  const blurred = boxBlurRgb(image, radius);

  for (let p = 0, i = 0; i < image.data.length; i += 4, p++) {
    const cover = coverage(mask, p);
    if (cover === 0) continue;

    const r = image.data[i]!;
    const g = image.data[i + 1]!;
    const b = image.data[i + 2]!;
    const grey = LUMA_R * r + LUMA_G * g + LUMA_B * b;

    const br = blurred.data[i]!;
    const bg = blurred.data[i + 1]!;
    const bb = blurred.data[i + 2]!;
    const blurredGrey = LUMA_R * br + LUMA_G * bg + LUMA_B * bb;

    // Luminance: move brightness toward the neighbourhood average, keeping the
    // pixel's own colour offsets.
    const newGrey = grey + (blurredGrey - grey) * lum;

    // Colour: move the chroma offsets toward the neighbourhood's, leaving
    // brightness alone.
    const chromaR = r - grey + (br - blurredGrey - (r - grey)) * chroma;
    const chromaG = g - grey + (bg - blurredGrey - (g - grey)) * chroma;
    const chromaB = b - grey + (bb - blurredGrey - (b - grey)) * chroma;

    const adjusted = [newGrey + chromaR, newGrey + chromaG, newGrey + chromaB];
    for (let c = 0; c < 3; c++) {
      const original = image.data[i + c]!;
      out.data[i + c] = clamp255(original + (adjusted[c]! - original) * cover);
    }
  }
  return out;
}
