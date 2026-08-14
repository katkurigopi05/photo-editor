import type { RasterImage } from "./types.js";

/**
 * Removing the colour a green screen throws onto its subject.
 *
 * Keying cuts the background out. It does nothing about the light the
 * background *reflected* — a green wall lights everything near it, so hair
 * edges, shoulders and pale skin come away with a green cast that survives the
 * key perfectly. Composite that over a new background and the subject looks
 * pasted on, and the usual reaction is to blame the edge quality rather than the
 * colour.
 *
 * The fix is old and simple: wherever the screen's channel exceeds what the
 * other two justify, pull it back to their level. On green, that is
 * `g > (r + b) / 2`. It only touches pixels that are actually too green, so a
 * genuinely green jumper keeps most of its colour — the suppression is
 * proportional, not a blanket desaturation.
 */

export type SpillChannel = "green" | "blue" | "red";

/** Which channel a screen contributes, by name. Blue screens are still used for
 * skin tones and for anything with green wardrobe, so the choice is real. */
const CHANNEL_INDEX: Readonly<Record<SpillChannel, number>> = {
  red: 0,
  green: 1,
  blue: 2,
};

/**
 * Suppress spill of one screen colour.
 *
 * `amount` runs 0–1: how much of the excess to remove. Partial exists because
 * full suppression on a subject that really is slightly green reads as a grey
 * patch, and an operator generally wants most of the cast gone rather than the
 * channel clamped.
 *
 * `preserveLuminance` puts back the brightness the suppression removed. Pulling
 * a channel down darkens the pixel, so an unprotected edge turns into a dark
 * fringe — which looks exactly like a bad matte and gets fixed by feathering
 * the matte, making it worse.
 */
export function suppressSpill(
  image: RasterImage,
  channel: SpillChannel = "green",
  amount = 1,
  preserveLuminance = true,
): RasterImage {
  const strength = Math.max(0, Math.min(1, amount));
  const data = new Uint8ClampedArray(image.data);
  if (strength === 0) return { ...image, data };

  const target = CHANNEL_INDEX[channel];
  // The two channels that decide how much of the screen colour is legitimate.
  const others = [0, 1, 2].filter((c) => c !== target);

  for (let i = 0; i < data.length; i += 4) {
    const value = data[i + target]!;
    const a = data[i + others[0]!]!;
    const b = data[i + others[1]!]!;
    const limit = (a + b) / 2;
    if (value <= limit) continue;

    const suppressed = value - (value - limit) * strength;

    if (preserveLuminance) {
      // Rec. 601, the same weights the rest of this package uses for luma.
      const before = luma(data[i]!, data[i + 1]!, data[i + 2]!);
      data[i + target] = suppressed;
      const after = luma(data[i]!, data[i + 1]!, data[i + 2]!);
      const deficit = before - after;
      if (deficit > 0) {
        // Returned to the two channels that were not suppressed, so the pixel
        // regains its brightness without regaining the cast.
        //
        // Divided by their combined luma weight, not added raw: adding `d` to
        // red and blue raises luminance by `d × (0.299 + 0.114)`, not by `d`.
        // Adding it directly restores only about 41% of what was lost, which
        // still leaves the dark fringe this exists to prevent — just a fainter
        // one, which is harder to notice and no less wrong.
        const share = LUMA_WEIGHTS[others[0]!]! + LUMA_WEIGHTS[others[1]!]!;
        const lift = share > 0 ? deficit / share : 0;
        for (const c of others) data[i + c] = data[i + c]! + lift;
      }
    } else {
      data[i + target] = suppressed;
    }
  }

  return { width: image.width, height: image.height, data };
}

/** Rec. 601, the weights the rest of this package uses for luma. */
const LUMA_WEIGHTS = [0.299, 0.587, 0.114] as const;

const luma = (r: number, g: number, b: number): number =>
  LUMA_WEIGHTS[0] * r + LUMA_WEIGHTS[1] * g + LUMA_WEIGHTS[2] * b;

/**
 * How much spill an image carries, as a fraction of its pixels.
 *
 * Not used to decide anything automatically — it is for telling the user
 * whether suppression is worth applying, and for tests to assert that
 * suppression actually reduced it rather than merely changing the picture.
 */
export function spillFraction(
  image: RasterImage,
  channel: SpillChannel = "green",
): number {
  const target = CHANNEL_INDEX[channel];
  const others = [0, 1, 2].filter((c) => c !== target);
  let count = 0;
  const total = image.data.length / 4;

  for (let i = 0; i < image.data.length; i += 4) {
    const value = image.data[i + target]!;
    const limit =
      (image.data[i + others[0]!]! + image.data[i + others[1]!]!) / 2;
    // A threshold rather than `>`: every photograph has pixels a code or two
    // above the average by noise alone, and counting those would report spill
    // on a picture that has none.
    if (value > limit + 8) count += 1;
  }
  return total === 0 ? 0 : count / total;
}
