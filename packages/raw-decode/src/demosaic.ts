import type { DngImageLayout } from "./dng.js";
import { cfaColourAt } from "./unpack.js";

/**
 * Turning one colour per sensor site into three colours per pixel.
 *
 * A sensor does not measure colour. Each site sits under a red, green or blue
 * filter and records one number; the other two channels at that position were
 * never measured and have to be inferred from neighbours that were. That is
 * demosaicing, and it is where a raw file becomes a picture.
 *
 * Bilinear: each missing channel is the average of the nearest sites that did
 * measure it. It is the simplest method that is actually correct on smooth
 * subjects, and its weakness is known and specific — fine detail near the
 * sampling limit produces colour fringing, because a green edge sampled at half
 * the sensor's pitch is indistinguishable from a magenta one. Better methods
 * exist (gradient-corrected, VNG, AHD) and all of them start from this, so this
 * is the right first implementation rather than a placeholder.
 *
 * Written against the CFA pattern rather than hard-coded for RGGB. There are
 * four Bayer phases and sensors use all of them, so a hard-coded one is right a
 * quarter of the time and swaps red for blue the rest — which reads as a
 * white-balance fault, not a bug here.
 */

export interface RgbImage {
  width: number;
  height: number;
  /** Interleaved RGB, three floats per pixel, each 0..1. */
  rgb: Float32Array;
}

const CHANNEL = { R: 0, G: 1, B: 2 } as const;

/**
 * Demosaic a normalised CFA image.
 *
 * `samples` is one value per sensor site, already black-subtracted and scaled
 * to 0..1 by `normaliseSamples`.
 *
 * Neighbours are gathered from the 3×3 around each pixel, widening to 5×5 only
 * if that found nothing.
 *
 * For a 2×2 Bayer sensor the 3×3 is always enough: every phase has all three
 * colours within one step. The widening exists for sparser repeats — a 4×4
 * pattern can place a colour two steps away — and it is not speculative, since
 * this reads the CFA pattern from the file rather than assuming Bayer. A test
 * covers a 4×4 repeat where the 3×3 genuinely comes up empty.
 *
 * (The first version of this comment claimed a 3×3 was insufficient for Bayer.
 * That was wrong, and a mutation that removed the widening passed every test —
 * which is how the wrong claim was found.)
 */
export function demosaicBilinear(
  samples: Float32Array,
  layout: Pick<DngImageLayout, "width" | "height" | "cfaPattern" | "cfaRepeat">,
): RgbImage | null {
  const { width, height } = layout;
  if (width <= 0 || height <= 0) return null;
  if (layout.cfaPattern.length === 0) return null;
  if (samples.length < width * height) return null;

  const rgb = new Float32Array(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const here = cfaColourAt(layout, x, y);
      const out = (y * width + x) * 3;

      // The measured channel is used as measured. Averaging it with neighbours
      // would blur real detail to no purpose — this is the one number at this
      // position that is not a guess.
      rgb[out + CHANNEL[here]] = samples[y * width + x]!;

      for (const channel of ["R", "G", "B"] as const) {
        if (channel === here) continue;

        let total = 0;
        let count = 0;
        // Nearest first, so the result stays as sharp as bilinear can be.
        // Radius 2 is reached only for sparse CFA repeats; Bayer never needs
        // it.
        for (let radius = 1; radius <= 2 && count === 0; radius += 1) {
          for (let dy = -radius; dy <= radius; dy += 1) {
            for (let dx = -radius; dx <= radius; dx += 1) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              if (cfaColourAt(layout, nx, ny) !== channel) continue;
              total += samples[ny * width + nx]!;
              count += 1;
            }
          }
        }

        // A pixel with no neighbour of this colour anywhere near can only
        // happen on a degenerate image — one or two pixels wide. Falling back
        // to the measured value keeps it grey rather than punching a hole.
        rgb[out + CHANNEL[channel]] =
          count > 0 ? total / count : samples[y * width + x]!;
      }
    }
  }

  return { width, height, rgb };
}

/**
 * Convert to 8-bit RGBA, which is what the rest of the app draws.
 *
 * A gamma curve is applied on the way. Sensor values are linear in light, and a
 * display is not: writing linear values straight to 8-bit produces an image
 * that looks far too dark, and crushes the shadows into a handful of codes
 * where most of the visible detail lives. sRGB's transfer function is the
 * standard answer and is what every other raw converter applies here.
 */
export function toRgba(image: RgbImage): Uint8ClampedArray {
  const out = new Uint8ClampedArray(image.width * image.height * 4);
  for (let p = 0, i = 0; p < image.width * image.height; p += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[i + c] = Math.round(srgbEncode(image.rgb[p * 3 + c]!) * 255);
    }
    out[i + 3] = 255;
    i += 4;
  }
  return out;
}

/**
 * sRGB's transfer function.
 *
 * The linear segment near black is not decoration: a pure power curve has an
 * infinite slope at zero, which makes the darkest codes unstable and noisy.
 */
export function srgbEncode(linear: number): number {
  const v = linear < 0 ? 0 : linear > 1 ? 1 : linear;
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}
