import type { RasterImage } from "./types.js";

/**
 * 3D colour lookup tables.
 *
 * A grading stack made only of *pointwise* effects — ones whose output for a
 * pixel depends on that pixel's colour and nothing else — is a pure function
 * from RGB to RGB. Such a function can be sampled once on a small cube of
 * colours and then applied to any image by interpolation, however large.
 *
 * That is worth doing because the cost stops depending on the number of
 * effects. Eight adjustments over a megapixel is eight million pixel
 * operations; the same eight over a 33³ cube is under three hundred thousand,
 * after which every image pixel costs one interpolated lookup. The saving is
 * biggest exactly where it is needed most — an adjustment layer grades the live
 * canvas every frame and cannot cache its result.
 *
 * The decisive property is that **the LUT is built by running the very same
 * grading code**. Nothing is reimplemented, so nothing can drift: a change to an
 * effect changes the cube it produces, automatically.
 */

/**
 * Samples per axis.
 *
 * 33 rather than 32 so the last sample lands exactly on 255 — with an even size
 * the top of the range falls between samples and pure white drifts, which is
 * visible as a tint in a blown highlight.
 */
export const LUT_SIZE = 33;

/**
 * An image containing every colour the cube samples, laid out as a grid.
 *
 * Feed this through a grading chain and the result is that chain's answer for
 * each sampled colour — which is exactly the table.
 */
export function identityCubeImage(size: number = LUT_SIZE): RasterImage {
  const width = size * size;
  const height = size;
  const data = new Uint8ClampedArray(width * height * 4);
  const step = 255 / (size - 1);
  let i = 0;
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        // Row = green, column = blue-major then red, so a row is contiguous.
        const x = b * size + r;
        const y = g;
        i = (y * width + x) * 4;
        data[i] = Math.round(r * step);
        data[i + 1] = Math.round(g * step);
        data[i + 2] = Math.round(b * step);
        data[i + 3] = 255;
      }
    }
  }
  return { width, height, data };
}

/** The table itself: `size³` RGB triples, red fastest. */
export type Lut3d = Uint8ClampedArray;

/** Read a graded cube image back into a table. */
export function cubeImageToLut(
  graded: RasterImage,
  size: number = LUT_SIZE,
): Lut3d {
  const lut = new Uint8ClampedArray(size * size * size * 3);
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        const x = b * size + r;
        const src = (g * graded.width + x) * 4;
        const dst = ((b * size + g) * size + r) * 3;
        lut[dst] = graded.data[src]!;
        lut[dst + 1] = graded.data[src + 1]!;
        lut[dst + 2] = graded.data[src + 2]!;
      }
    }
  }
  return lut;
}

/**
 * Apply a table to an image, interpolating trilinearly between samples.
 *
 * Nearest-neighbour would be faster and would band: 33 samples per axis is
 * about eight levels apart, and a gradient stepping in eights is obvious on a
 * sky. Interpolating costs eight reads per pixel and removes it.
 */
export function applyLut3d(
  image: RasterImage,
  lut: Lut3d,
  size: number = LUT_SIZE,
): RasterImage {
  const data = new Uint8ClampedArray(image.data);
  const last = size - 1;
  const scale = last / 255;

  for (let i = 0; i < data.length; i += 4) {
    const rf = data[i]! * scale;
    const gf = data[i + 1]! * scale;
    const bf = data[i + 2]! * scale;

    const r0 = Math.floor(rf);
    const g0 = Math.floor(gf);
    const b0 = Math.floor(bf);
    const r1 = r0 < last ? r0 + 1 : r0;
    const g1 = g0 < last ? g0 + 1 : g0;
    const b1 = b0 < last ? b0 + 1 : b0;
    const dr = rf - r0;
    const dg = gf - g0;
    const db = bf - b0;

    let outR = 0;
    let outG = 0;
    let outB = 0;
    // Eight corners of the cell, weighted by distance from each.
    for (let corner = 0; corner < 8; corner += 1) {
      const useR1 = (corner & 1) !== 0;
      const useG1 = (corner & 2) !== 0;
      const useB1 = (corner & 4) !== 0;
      const weight =
        (useR1 ? dr : 1 - dr) * (useG1 ? dg : 1 - dg) * (useB1 ? db : 1 - db);
      if (weight === 0) continue;
      const idx =
        (((useB1 ? b1 : b0) * size + (useG1 ? g1 : g0)) * size +
          (useR1 ? r1 : r0)) *
        3;
      outR += lut[idx]! * weight;
      outG += lut[idx + 1]! * weight;
      outB += lut[idx + 2]! * weight;
    }

    data[i] = Math.round(outR);
    data[i + 1] = Math.round(outG);
    data[i + 2] = Math.round(outB);
  }
  return { width: image.width, height: image.height, data };
}

/**
 * Is a grading function pointwise?
 *
 * Answered by experiment rather than by trusting a list: the same colours are
 * graded in two different spatial arrangements, and a function that consults
 * its neighbours will disagree between them. Used by the tests to keep the
 * runtime's allowlist honest — a blur added to a "pointwise" effect would make
 * this fail rather than silently corrupt every LUT built from it.
 */
export function isPointwise(
  grade: (image: RasterImage) => RasterImage,
  size = 8,
): boolean {
  const colours: Array<[number, number, number]> = [];
  for (let i = 0; i < size * size; i += 1) {
    colours.push([(i * 7) % 256, (i * 29) % 256, (i * 53) % 256]);
  }
  const build = (order: number[]): RasterImage => {
    const data = new Uint8ClampedArray(size * size * 4);
    order.forEach((source, index) => {
      const c = colours[source]!;
      data[index * 4] = c[0];
      data[index * 4 + 1] = c[1];
      data[index * 4 + 2] = c[2];
      data[index * 4 + 3] = 255;
    });
    return { width: size, height: size, data };
  };

  const straight = order(colours.length, false);
  const shuffled = order(colours.length, true);

  const a = grade(build(straight));
  const b = grade(build(shuffled));

  for (let index = 0; index < straight.length; index += 1) {
    const source = straight[index]!;
    const mirror = shuffled.indexOf(source);
    for (let channel = 0; channel < 3; channel += 1) {
      const left = a.data[index * 4 + channel]!;
      const right = b.data[mirror * 4 + channel]!;
      // A rounding difference is not evidence of neighbourhood dependence.
      if (Math.abs(left - right) > 1) return false;
    }
  }
  return true;
}

/**
 * A permutation of `0..count-1`.
 *
 * The scrambled form is a stride, not a reversal. Reversing is too weak to
 * detect a *symmetric* neighbourhood: a three-tap mean sees the same two
 * neighbours either way round and agrees with itself, so a blur would be
 * declared pointwise. A stride coprime with the length moves every pixel beside
 * different neighbours while still visiting each exactly once.
 */
function order(count: number, scrambled: boolean): number[] {
  const list = Array.from({ length: count }, (_, i) => i);
  if (!scrambled) return list;
  let stride = 7;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  while (stride < count && gcd(stride, count) !== 1) stride += 2;
  return list.map((_, i) => (i * stride + 3) % count);
}
