/**
 * Tone and colour adjustments modelled on Adobe Lightroom's Light and Colour
 * panels — see the `Lightroom Feature Reference` note in the Photo_Editor
 * vault for what we adopt and what we deliberately leave out.
 *
 * Two properties every function here shares:
 *
 * 1. **Pure.** Input is never mutated; a new `RasterImage` is returned. Alpha is
 *    carried through untouched.
 * 2. **Mask-aware.** Every adjustment takes an optional {@link Mask} and blends
 *    per pixel by the mask's coverage byte, so *any* of them doubles as a local
 *    adjustment. This is the property that makes Lightroom's masking model work:
 *    a mask is not a special kind of edit, it is a region any edit can be
 *    confined to. Feathered edges fall out of the blend for free, because
 *    partial coverage produces a partial application.
 *
 * All strengths use Lightroom's own convention of −100…+100 with 0 = no change,
 * so slider values map across directly.
 */
import {
  cloneImage,
  type Mask,
  type RasterImage,
  createMask,
} from "./types.js";

/** Rec. 709 luma — the perceptual weighting used throughout this module. */
export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

/** Coverage of `mask` at pixel `p`, as 0…1. No mask means fully covered. */
function coverage(mask: Mask | undefined, p: number): number {
  if (!mask) return 1;
  return (mask.data[p] ?? 0) / 255;
}

/**
 * Apply a per-pixel RGB transform, blended through an optional mask.
 *
 * This is the single place the mask blend lives — every public adjustment is
 * written as a plain colour function and routed through here, so masking
 * behaviour cannot drift between them.
 */
export function mapPixels(
  image: RasterImage,
  mask: Mask | undefined,
  transform: (r: number, g: number, b: number) => [number, number, number],
): RasterImage {
  if (mask && (mask.width !== image.width || mask.height !== image.height)) {
    throw new Error(
      `mask ${mask.width}x${mask.height} does not match image ${image.width}x${image.height}`,
    );
  }
  const out = cloneImage(image);
  for (let p = 0, i = 0; i < image.data.length; i += 4, p++) {
    const cover = coverage(mask, p);
    if (cover === 0) continue;
    const r = image.data[i]!;
    const g = image.data[i + 1]!;
    const b = image.data[i + 2]!;
    const [nr, ng, nb] = transform(r, g, b);
    out.data[i] = clamp255(r + (nr - r) * cover);
    out.data[i + 1] = clamp255(g + (ng - g) * cover);
    out.data[i + 2] = clamp255(b + (nb - b) * cover);
  }
  return out;
}

// --- Light panel -----------------------------------------------------------

/** Exposure in stops (−5…+5); each stop doubles or halves linear intensity. */
export function exposure(
  image: RasterImage,
  stops: number,
  mask?: Mask,
): RasterImage {
  const factor = Math.pow(2, stops);
  return mapPixels(image, mask, (r, g, b) => [
    r * factor,
    g * factor,
    b * factor,
  ]);
}

/** Contrast (−100…+100), pivoting around mid-grey so overall brightness holds. */
export function contrast(
  image: RasterImage,
  amount: number,
  mask?: Mask,
): RasterImage {
  const factor = 1 + amount / 100;
  const pivot = 127.5;
  return mapPixels(image, mask, (r, g, b) => [
    pivot + (r - pivot) * factor,
    pivot + (g - pivot) * factor,
    pivot + (b - pivot) * factor,
  ]);
}

/**
 * Weight a pixel's luma toward one end of the tonal range.
 * `power` shapes how tightly the effect clings to that end.
 */
function toneWeight(
  value: number,
  towardBright: boolean,
  power: number,
): number {
  const t = value / 255;
  return Math.pow(towardBright ? t : 1 - t, power);
}

/**
 * Recover or brighten the bright end (−100…+100). Negative pulls blown
 * highlights back; positive lifts them further. Shadows are left alone because
 * the weight falls off toward black.
 */
export function highlights(
  image: RasterImage,
  amount: number,
  mask?: Mask,
): RasterImage {
  return toneRegion(image, amount, mask, true, 2);
}

/** Lift or deepen the dark end (−100…+100), leaving highlights alone. */
export function shadows(
  image: RasterImage,
  amount: number,
  mask?: Mask,
): RasterImage {
  return toneRegion(image, amount, mask, false, 2);
}

/** Move the white point (−100…+100) — a broader reach than {@link highlights}. */
export function whites(
  image: RasterImage,
  amount: number,
  mask?: Mask,
): RasterImage {
  return toneRegion(image, amount, mask, true, 1);
}

/** Move the black point (−100…+100) — a broader reach than {@link shadows}. */
export function blacks(
  image: RasterImage,
  amount: number,
  mask?: Mask,
): RasterImage {
  return toneRegion(image, amount, mask, false, 1);
}

function toneRegion(
  image: RasterImage,
  amount: number,
  mask: Mask | undefined,
  towardBright: boolean,
  power: number,
): RasterImage {
  const shift = amount * 1.28; // ±100 → ±128 levels at full weight
  return mapPixels(image, mask, (r, g, b) => {
    const weight = toneWeight(luma(r, g, b), towardBright, power);
    const delta = shift * weight;
    return [r + delta, g + delta, b + delta];
  });
}

// --- Colour panel ----------------------------------------------------------

/** Warm/cool (−100 cool … +100 warm) along the blue–orange axis. */
export function temperature(
  image: RasterImage,
  amount: number,
  mask?: Mask,
): RasterImage {
  const shift = amount * 0.6;
  return mapPixels(image, mask, (r, g, b) => [r + shift, g, b - shift]);
}

/** Green/magenta tint (−100 green … +100 magenta). */
export function tint(
  image: RasterImage,
  amount: number,
  mask?: Mask,
): RasterImage {
  const shift = amount * 0.6;
  return mapPixels(image, mask, (r, g, b) => [
    r + shift / 2,
    g - shift,
    b + shift / 2,
  ]);
}

/** Uniform saturation (−100 = greyscale … +100). */
export function saturation(
  image: RasterImage,
  amount: number,
  mask?: Mask,
): RasterImage {
  const factor = 1 + amount / 100;
  return mapPixels(image, mask, (r, g, b) => {
    const grey = luma(r, g, b);
    return [
      grey + (r - grey) * factor,
      grey + (g - grey) * factor,
      grey + (b - grey) * factor,
    ];
  });
}

/**
 * Saturation weighted toward already-muted pixels (−100…+100). Colours that are
 * already vivid move least, which is what keeps skin tones from going lurid —
 * Lightroom's reason for offering this next to plain saturation.
 */
export function vibrance(
  image: RasterImage,
  amount: number,
  mask?: Mask,
): RasterImage {
  const strength = amount / 100;
  return mapPixels(image, mask, (r, g, b) => {
    const grey = luma(r, g, b);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const current = max === 0 ? 0 : (max - min) / max; // 0 = grey, 1 = vivid
    const factor = 1 + strength * (1 - current);
    return [
      grey + (r - grey) * factor,
      grey + (g - grey) * factor,
      grey + (b - grey) * factor,
    ];
  });
}

// --- Colour Mixer (HSL) ----------------------------------------------------

/** The eight colour bands Lightroom's Colour Mixer splits the wheel into. */
export const HSL_BANDS = [
  "red",
  "orange",
  "yellow",
  "green",
  "aqua",
  "blue",
  "purple",
  "magenta",
] as const;

export type HslBand = (typeof HSL_BANDS)[number];

/** Hue/saturation/luminance offsets for one band, each −100…+100. */
export interface HslAdjustment {
  hue?: number;
  saturation?: number;
  luminance?: number;
}

/** Centre hue of each band, in degrees on the colour wheel. */
const BAND_HUE: Record<HslBand, number> = {
  red: 0,
  orange: 30,
  yellow: 60,
  green: 120,
  aqua: 180,
  blue: 240,
  purple: 280,
  magenta: 320,
};

export function rgbToHsl(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return [0, 0, l];
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

export function hslToRgb(
  h: number,
  s: number,
  l: number,
): [number, number, number] {
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
}

/** Shortest angular distance between two hues, in degrees (0…180). */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Lightroom's Colour Mixer: per-band hue / saturation / luminance offsets.
 *
 * A pixel's membership in a band falls off smoothly with hue distance, and
 * bands overlap, so a colour sitting between orange and yellow is influenced by
 * both in proportion. That smooth falloff is what stops banded, posterised
 * edges where two adjacent bands are pushed in opposite directions.
 *
 * Near-grey pixels are left alone — their hue is meaningless and nudging it
 * produces coloured noise in what should stay neutral.
 */
export function colorMixer(
  image: RasterImage,
  bands: Partial<Record<HslBand, HslAdjustment>>,
  mask?: Mask,
): RasterImage {
  const entries = Object.entries(bands) as [HslBand, HslAdjustment][];
  if (entries.length === 0) return cloneImage(image);
  const falloff = 60; // degrees at which a band's influence reaches zero

  return mapPixels(image, mask, (r, g, b) => {
    const [h, s, l] = rgbToHsl(r, g, b);
    if (s < 0.02) return [r, g, b]; // effectively grey — no meaningful hue

    let hueShift = 0;
    let satScale = 0;
    let lumScale = 0;
    let total = 0;

    for (const [band, adj] of entries) {
      const distance = hueDistance(h, BAND_HUE[band]);
      if (distance >= falloff) continue;
      const weight = 1 - distance / falloff;
      hueShift += (adj.hue ?? 0) * 0.3 * weight;
      satScale += ((adj.saturation ?? 0) / 100) * weight;
      lumScale += ((adj.luminance ?? 0) / 100) * weight;
      total += weight;
    }
    if (total === 0) return [r, g, b];

    const newS = Math.max(0, Math.min(1, s * (1 + satScale)));
    const newL = Math.max(0, Math.min(1, l * (1 + lumScale)));
    return hslToRgb(h + hueShift, newS, newL);
  });
}

// --- Mask composition ------------------------------------------------------

/** How a mask contribution combines with what came before it. */
export type MaskMode = "add" | "subtract" | "intersect";

/**
 * Compose mask contributions in order, the way Lightroom stacks them: the first
 * establishes the region, each later one adds to, subtracts from, or intersects
 * with the running result.
 *
 * Working on coverage bytes rather than booleans keeps feathering intact
 * through the whole stack — `intersect` multiplies coverage, `subtract` removes
 * it proportionally.
 */
export function composeMasks(
  width: number,
  height: number,
  contributions: readonly { mask: Mask; mode: MaskMode }[],
): Mask {
  const out = createMask(width, height);
  if (contributions.length === 0) return out;

  for (const [index, { mask, mode }] of contributions.entries()) {
    if (mask.width !== width || mask.height !== height) {
      throw new Error(
        `contribution ${index} is ${mask.width}x${mask.height}, expected ${width}x${height}`,
      );
    }
    for (let p = 0; p < out.data.length; p++) {
      const existing = index === 0 ? 0 : out.data[p]!;
      const incoming = mask.data[p]!;
      // The first contribution seeds the region regardless of its mode;
      // there is nothing yet to add to, subtract from, or intersect with.
      if (index === 0) {
        out.data[p] = incoming;
        continue;
      }
      if (mode === "add") {
        out.data[p] = Math.max(existing, incoming);
      } else if (mode === "subtract") {
        out.data[p] = (existing * (255 - incoming)) / 255;
      } else {
        out.data[p] = (existing * incoming) / 255;
      }
    }
  }
  return out;
}

// --- Colour Grading (three-way) --------------------------------------------

/** One grading wheel: a hue to push toward, and how hard to push. */
export interface GradingWheel {
  /** Hue in degrees, 0…360. */
  hue: number;
  /** Strength 0…100. */
  saturation: number;
}

export interface ColorGradingOptions {
  shadows?: GradingWheel;
  midtones?: GradingWheel;
  highlights?: GradingWheel;
  /**
   * Where the boundary between shadows and highlights sits, −100…+100.
   * Positive moves the boundary down, so more of the picture counts as
   * highlight; negative moves it up and widens the shadow band. Lightroom's
   * Balance slider.
   */
  balance?: number;
  /** Overall strength of the whole grade, 0…100. Defaults to 100. */
  blend?: number;
}

/** Weight for each tonal band at luminance `t` (0…1), after balance. */
function bandWeights(
  t: number,
  balance: number,
): { shadow: number; mid: number; high: number } {
  // Balance slides the crossover point; at 0 the bands meet at mid-grey.
  const pivot = 0.5 - (balance / 100) * 0.3;
  const shadow = Math.max(0, 1 - t / Math.max(0.001, pivot));
  const high = Math.max(0, (t - pivot) / Math.max(0.001, 1 - pivot));
  // Midtones are what neither end claims, which keeps the three weights from
  // summing past 1 and over-tinting the middle of the range.
  const mid = Math.max(0, 1 - shadow - high);
  return { shadow, mid, high };
}

/**
 * Lightroom's Colour Grading: separate hue/strength wheels for shadows,
 * midtones and highlights, plus a balance control over where those bands sit.
 *
 * Each wheel pushes its band toward a colour rather than replacing it, so a
 * graded frame keeps its own tonality — the point of grading is a cast, not a
 * duotone. Weights are computed from luminance and normalized so the three
 * bands cannot stack into a saturated mess in the middle.
 */
export function colorGrading(
  image: RasterImage,
  options: ColorGradingOptions,
  mask?: Mask,
): RasterImage {
  const { shadows, midtones, highlights } = options;
  if (!shadows && !midtones && !highlights) return cloneImage(image);

  const balance = options.balance ?? 0;
  const blend = (options.blend ?? 100) / 100;

  const target = (wheel: GradingWheel | undefined): [number, number, number] =>
    wheel ? hslToRgb(wheel.hue, 1, 0.5) : [0, 0, 0];
  const shadowTint = target(shadows);
  const midTint = target(midtones);
  const highTint = target(highlights);

  return mapPixels(image, mask, (r, g, b) => {
    const t = luma(r, g, b) / 255;
    const weights = bandWeights(t, balance);
    const contributions: [number, [number, number, number], number][] = [
      [weights.shadow, shadowTint, (shadows?.saturation ?? 0) / 100],
      [weights.mid, midTint, (midtones?.saturation ?? 0) / 100],
      [weights.high, highTint, (highlights?.saturation ?? 0) / 100],
    ];

    let nr = r;
    let ng = g;
    let nb = b;
    for (const [weight, tint, strength] of contributions) {
      const amount = weight * strength * blend;
      if (amount <= 0) continue;
      // Push toward the tint at constant luminance: mix in the tint's colour
      // while keeping the pixel's own brightness, so grading does not double as
      // an exposure change.
      const tintLuma = luma(tint[0], tint[1], tint[2]);
      const scale = tintLuma === 0 ? 0 : luma(nr, ng, nb) / tintLuma;
      nr += (tint[0] * scale - nr) * amount * 0.5;
      ng += (tint[1] * scale - ng) * amount * 0.5;
      nb += (tint[2] * scale - nb) * amount * 0.5;
    }
    return [nr, ng, nb];
  });
}
