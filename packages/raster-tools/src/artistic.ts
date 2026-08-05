import { boxBlurRgb } from "./filters.js";
import { cloneImage, type RasterImage } from "./types.js";

/**
 * Painterly stylization.
 *
 * Every function here is pure and deterministic — including the paper grain,
 * which is a hash of the pixel coordinate rather than `Math.random`. That is
 * not fussiness: these run inside the shared draw path, once per exported
 * frame, so a random grain would give every GIF frame different speckle and
 * break the preview/GIF/MP4 agreement the renderer is built around.
 *
 * Alpha is always carried through untouched, so a stylized clip still keys out
 * against a removed background or a cartoon's transparent field.
 */

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

function luma(data: Uint8ClampedArray, i: number): number {
  return LUMA_R * data[i]! + LUMA_G * data[i + 1]! + LUMA_B * data[i + 2]!;
}

/**
 * Deterministic value noise in [0, 1) from a pixel coordinate.
 *
 * An integer hash rather than a PRNG so it needs no state and gives the same
 * speckle for the same pixel on every frame and in every output size.
 */
export function grainAt(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

/**
 * Pencil drawing on paper.
 *
 * The colour-dodge sketch: take luminance, invert it, blur that, then dodge the
 * luminance against it. Flat regions saturate to white paper while edges — the
 * only places where a pixel differs sharply from its blurred inverse — survive
 * as graphite. `strength` mixes back toward the untouched grayscale, and
 * `grain` adds paper tooth.
 */
export function pencilSketch(
  image: RasterImage,
  strength: number,
  grain: number,
): RasterImage {
  const out = cloneImage(image);
  const gray = cloneImage(image);
  for (let i = 0; i < gray.data.length; i += 4) {
    // Invert as we go: the blur below needs the inverted copy, and the
    // original luminance is recomputed per pixel in the dodge.
    const value = 255 - luma(image.data, i);
    gray.data[i] = value;
    gray.data[i + 1] = value;
    gray.data[i + 2] = value;
  }
  const blurred = boxBlurRgb(gray, Math.max(1, Math.round(image.width / 120)));

  const mix = Math.max(0, Math.min(1, strength));
  const grainAmount = Math.max(0, Math.min(1, grain));
  for (let i = 0, p = 0; i < out.data.length; i += 4, p++) {
    const base = luma(image.data, i);
    const blend = blurred.data[i]!;
    // Colour dodge. blend === 255 means the blurred inverse is pure white,
    // which dodges to white however dark the base is.
    const dodged =
      blend >= 255 ? 255 : Math.min(255, (base * 255) / (255 - blend));
    let value = base + (dodged - base) * mix;
    if (grainAmount > 0) {
      const x = p % image.width;
      const y = (p - x) / image.width;
      // Centred on zero so grain darkens and lightens rather than only dimming.
      value += (grainAt(x, y) - 0.5) * 60 * grainAmount;
    }
    out.data[i] = value;
    out.data[i + 1] = value;
    out.data[i + 2] = value;
  }
  return out;
}

/**
 * Oil painting, via the Kuwahara filter.
 *
 * For each pixel, the neighbourhood is split into four overlapping quadrants
 * and the mean of whichever has the lowest luminance variance is taken. Flat
 * regions pool into brush strokes while edges stay sharp, because a quadrant
 * straddling an edge always has higher variance than one that does not. That
 * is what separates this from a blur: blurring destroys the edges this
 * preserves.
 *
 * Cost is O(width * height * radius^2), so callers cap the radius and cache
 * the result for still media.
 */
export function oilPainting(image: RasterImage, radiusPx: number): RasterImage {
  const r = Math.max(1, Math.round(radiusPx));
  const { width, height, data } = image;
  const out = cloneImage(image);

  // Quadrant origins relative to the pixel: top-left, top-right, bottom-left,
  // bottom-right. Each spans r+1 pixels and includes the pixel itself.
  const quadrants: readonly (readonly [number, number])[] = [
    [-r, -r],
    [0, -r],
    [-r, 0],
    [0, 0],
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let bestVariance = Number.POSITIVE_INFINITY;
      let bestR = 0;
      let bestG = 0;
      let bestB = 0;

      for (const [ox, oy] of quadrants) {
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let sumL = 0;
        let sumLL = 0;
        let count = 0;
        for (let dy = 0; dy <= r; dy++) {
          const sy = y + oy + dy;
          if (sy < 0 || sy >= height) continue;
          for (let dx = 0; dx <= r; dx++) {
            const sx = x + ox + dx;
            if (sx < 0 || sx >= width) continue;
            const i = (sy * width + sx) * 4;
            const l = luma(data, i);
            sumR += data[i]!;
            sumG += data[i + 1]!;
            sumB += data[i + 2]!;
            sumL += l;
            sumLL += l * l;
            count++;
          }
        }
        if (count === 0) continue;
        const meanL = sumL / count;
        const variance = sumLL / count - meanL * meanL;
        if (variance < bestVariance) {
          bestVariance = variance;
          bestR = sumR / count;
          bestG = sumG / count;
          bestB = sumB / count;
        }
      }

      const i = (y * width + x) * 4;
      out.data[i] = bestR;
      out.data[i + 1] = bestG;
      out.data[i + 2] = bestB;
    }
  }
  return out;
}

/**
 * Cel-shaded cartoon: flatten colour into bands, then ink the edges.
 *
 * Posterizing alone reads as a compression artefact; the Sobel outline is what
 * makes it read as drawn. Edges are darkened rather than painted pure black so
 * the ink follows the colour underneath it.
 */
export function cartoonPosterize(
  image: RasterImage,
  levels: number,
  edgeStrength: number,
): RasterImage {
  const bands = Math.max(2, Math.min(16, Math.round(levels)));
  const step = 255 / (bands - 1);
  const { width, height, data } = image;
  const out = cloneImage(image);

  for (let i = 0; i < data.length; i += 4) {
    out.data[i] = Math.round(data[i]! / step) * step;
    out.data[i + 1] = Math.round(data[i + 1]! / step) * step;
    out.data[i + 2] = Math.round(data[i + 2]! / step) * step;
  }

  const ink = Math.max(0, Math.min(1, edgeStrength));
  if (ink === 0) return out;

  // Sobel on the *original* luminance: posterized input would give banding
  // edges everywhere the quantizer stepped, not the picture's real contours.
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const at = (dx: number, dy: number): number =>
        luma(data, ((y + dy) * width + (x + dx)) * 4);
      const gx =
        -at(-1, -1) -
        2 * at(-1, 0) -
        at(-1, 1) +
        at(1, -1) +
        2 * at(1, 0) +
        at(1, 1);
      const gy =
        -at(-1, -1) -
        2 * at(0, -1) -
        at(1, -1) +
        at(-1, 1) +
        2 * at(0, 1) +
        at(1, 1);
      const magnitude = Math.hypot(gx, gy);
      if (magnitude < 60) continue;
      const darken = 1 - Math.min(1, (magnitude / 255) * ink);
      const i = (y * width + x) * 4;
      out.data[i] = out.data[i]! * darken;
      out.data[i + 1] = out.data[i + 1]! * darken;
      out.data[i + 2] = out.data[i + 2]! * darken;
    }
  }
  return out;
}

/**
 * Watercolour: pooled pigment with a dried rim on the edges.
 *
 * Built from the pieces already here rather than a new algorithm — Kuwahara
 * pools the colour, a Sobel pass darkens where the pigment dried against an
 * edge, and the coordinate hash supplies paper tooth. Saturation is lifted a
 * little because pooling averages toward grey and washes look weaker than the
 * paint that made them.
 */
export function watercolor(
  image: RasterImage,
  poolRadiusPx: number,
  edgeStrength: number,
  grain: number,
): RasterImage {
  const out = oilPainting(image, poolRadiusPx);
  const { width, height, data } = image;
  const ink = Math.max(0, Math.min(1, edgeStrength));
  const grainAmount = Math.max(0, Math.min(1, grain));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Lift saturation around the pixel's own mean, which brightens colour
      // without shifting hue.
      const mean = (out.data[i]! + out.data[i + 1]! + out.data[i + 2]!) / 3;
      for (let c = 0; c < 3; c++) {
        out.data[i + c] = mean + (out.data[i + c]! - mean) * 1.25;
      }

      if (ink > 0 && x > 0 && y > 0 && x < width - 1 && y < height - 1) {
        const at = (dx: number, dy: number): number =>
          luma(data, ((y + dy) * width + (x + dx)) * 4);
        const gx = at(1, 0) - at(-1, 0);
        const gy = at(0, 1) - at(0, -1);
        const edge = Math.min(1, Math.hypot(gx, gy) / 160);
        if (edge > 0.15) {
          const darken = 1 - edge * ink * 0.55;
          for (let c = 0; c < 3; c++)
            out.data[i + c] = out.data[i + c]! * darken;
        }
      }

      if (grainAmount > 0) {
        const tooth = 1 - (grainAt(x, y) - 0.5) * 0.22 * grainAmount;
        for (let c = 0; c < 3; c++) out.data[i + c] = out.data[i + c]! * tooth;
      }
    }
  }
  return out;
}

/** Whether (x, y) sits on a hatch line of `spacing` at `angleDegrees`. */
function onHatchLine(
  x: number,
  y: number,
  angleDegrees: number,
  spacing: number,
): boolean {
  const radians = (angleDegrees * Math.PI) / 180;
  // Distance along the axis perpendicular to the lines; lines are where that
  // distance lands near a multiple of the spacing.
  const projected = x * Math.sin(radians) + y * Math.cos(radians);
  const offset = ((projected % spacing) + spacing) % spacing;
  return offset < 1;
}

/**
 * Ink crosshatch: darker areas get more layers of hatching.
 *
 * No blur and no averaging — the line position is a function of the
 * coordinate, so this is pure geometry driven by luminance. Layers are added
 * at different angles as the tone darkens, which is how hand hatching builds
 * value.
 */
export function crosshatch(
  image: RasterImage,
  spacingPx: number,
  darkness: number,
): RasterImage {
  const spacing = Math.max(2, Math.round(spacingPx));
  const strength = Math.max(0, Math.min(1, darkness));
  const { width, height, data } = image;
  const out = cloneImage(image);
  // Each threshold adds a layer as the tone passes below it.
  const layers: readonly (readonly [number, number])[] = [
    [0.82, 45],
    [0.62, -45],
    [0.42, 0],
    [0.22, 90],
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const value = luma(data, i) / 255;
      let inked = false;
      for (const [threshold, angle] of layers) {
        if (value < threshold && onHatchLine(x, y, angle, spacing)) {
          inked = true;
          break;
        }
      }
      const paper = 255;
      const level = inked ? paper * (1 - strength) : paper;
      out.data[i] = level;
      out.data[i + 1] = level;
      out.data[i + 2] = level;
    }
  }
  return out;
}

/**
 * Halftone: a print-style dot screen whose dots grow as the tone darkens.
 *
 * The dot for a cell is sized from that cell's own average tone rather than
 * per-pixel luminance, which is what makes it read as a screen rather than as
 * noise.
 */
export function halftone(
  image: RasterImage,
  cellPx: number,
  angleDegrees: number,
): RasterImage {
  const cell = Math.max(2, Math.round(cellPx));
  const radians = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const { width, height, data } = image;
  const out = cloneImage(image);

  // Average tone per cell in the rotated screen space, computed once.
  const cellTone = new Map<string, { sum: number; count: number }>();
  const cellOf = (x: number, y: number): [number, number] => {
    const u = x * cos + y * sin;
    const v = -x * sin + y * cos;
    return [Math.floor(u / cell), Math.floor(v / cell)];
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [cu, cv] = cellOf(x, y);
      const key = `${cu},${cv}`;
      const entry = cellTone.get(key) ?? { sum: 0, count: 0 };
      entry.sum += luma(data, (y * width + x) * 4);
      entry.count++;
      cellTone.set(key, entry);
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const u = x * cos + y * sin;
      const v = -x * sin + y * cos;
      const cu = Math.floor(u / cell);
      const cv = Math.floor(v / cell);
      const entry = cellTone.get(`${cu},${cv}`)!;
      const tone = entry.sum / entry.count / 255;
      // A dot covering the whole cell would still leave the corners, so the
      // darkest tone reaches slightly past half the cell.
      const radius = (1 - tone) * cell * 0.72;
      const du = u - (cu * cell + cell / 2);
      const dv = v - (cv * cell + cell / 2);
      const level = Math.hypot(du, dv) <= radius ? 0 : 255;
      out.data[i] = level;
      out.data[i + 1] = level;
      out.data[i + 2] = level;
    }
  }
  return out;
}
