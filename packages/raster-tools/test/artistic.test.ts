import { describe, expect, it } from "vitest";
import {
  cartoonPosterize,
  crosshatch,
  grainAt,
  halftone,
  oilPainting,
  pencilSketch,
  watercolor,
} from "../src/artistic.js";
import { createImage, type RasterImage } from "../src/types.js";

/** Solid block of one colour. */
function solid(
  w: number,
  h: number,
  rgb: [number, number, number],
): RasterImage {
  const image = createImage(w, h);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = rgb[0];
    image.data[i + 1] = rgb[1];
    image.data[i + 2] = rgb[2];
    image.data[i + 3] = 255;
  }
  return image;
}

/** Left half dark, right half light — a single hard vertical edge. */
function splitEdge(w = 16, h = 8): RasterImage {
  const image = createImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = x < w / 2 ? 30 : 220;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  return image;
}

const at = (img: RasterImage, x: number, y: number): number =>
  img.data[(y * img.width + x) * 4]!;

describe("grainAt", () => {
  it("is deterministic for a coordinate", () => {
    // The whole reason this is a hash and not Math.random: every exported
    // frame must get identical speckle, or preview and export diverge.
    expect(grainAt(7, 11)).toBe(grainAt(7, 11));
  });

  it("differs between neighbouring pixels", () => {
    expect(grainAt(7, 11)).not.toBe(grainAt(8, 11));
    expect(grainAt(7, 11)).not.toBe(grainAt(7, 12));
  });

  it("stays inside [0, 1)", () => {
    for (let x = 0; x < 40; x++) {
      for (let y = 0; y < 40; y++) {
        const v = grainAt(x, y);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });
});

describe("pencilSketch", () => {
  it("turns a flat area into white paper", () => {
    // Nothing to draw: the dodge saturates.
    const out = pencilSketch(solid(12, 12, [120, 120, 120]), 1, 0);
    expect(at(out, 6, 6)).toBeGreaterThan(230);
  });

  it("leaves graphite at an edge", () => {
    const out = pencilSketch(splitEdge(), 1, 0);
    const edge = Math.min(at(out, 7, 4), at(out, 8, 4));
    const flat = at(out, 1, 4);
    expect(edge).toBeLessThan(flat);
  });

  it("produces a gray image, not a tinted one", () => {
    const out = pencilSketch(solid(8, 8, [200, 40, 40]), 1, 0);
    const i = 0;
    expect(out.data[i]).toBe(out.data[i + 1]);
    expect(out.data[i + 1]).toBe(out.data[i + 2]);
  });

  it("is deterministic even with grain on", () => {
    const a = pencilSketch(splitEdge(), 1, 1);
    const b = pencilSketch(splitEdge(), 1, 1);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it("preserves alpha", () => {
    const image = solid(6, 6, [100, 100, 100]);
    image.data[3] = 0;
    const out = pencilSketch(image, 1, 0);
    expect(out.data[3]).toBe(0);
  });
});

describe("oilPainting", () => {
  it("keeps a hard edge hard", () => {
    // The point of Kuwahara over a blur: no intermediate values appear across
    // the boundary.
    const out = oilPainting(splitEdge(), 3);
    expect(at(out, 6, 4)).toBeLessThan(70);
    expect(at(out, 9, 4)).toBeGreaterThan(180);
  });

  it("leaves a flat region flat", () => {
    const out = oilPainting(solid(12, 12, [90, 140, 200]), 2);
    const i = (6 * 12 + 6) * 4;
    expect(out.data[i]).toBeCloseTo(90, 0);
    expect(out.data[i + 1]).toBeCloseTo(140, 0);
    expect(out.data[i + 2]).toBeCloseTo(200, 0);
  });

  it("is deterministic", () => {
    const a = oilPainting(splitEdge(), 2);
    const b = oilPainting(splitEdge(), 2);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it("preserves image dimensions and alpha", () => {
    const image = splitEdge();
    image.data[3] = 0;
    const out = oilPainting(image, 2);
    expect(out.width).toBe(image.width);
    expect(out.height).toBe(image.height);
    expect(out.data[3]).toBe(0);
  });
});

describe("cartoonPosterize", () => {
  it("collapses a gradient into discrete bands", () => {
    const image = createImage(64, 1);
    for (let x = 0; x < 64; x++) {
      const i = x * 4;
      const v = Math.round((x / 63) * 255);
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
    const out = cartoonPosterize(image, 4, 0);
    const distinct = new Set<number>();
    for (let x = 0; x < 64; x++) distinct.add(out.data[x * 4]!);
    expect(distinct.size).toBeLessThanOrEqual(4);
  });

  it("inks an edge darker than the band beside it", () => {
    const flat = cartoonPosterize(splitEdge(), 4, 0);
    const inked = cartoonPosterize(splitEdge(), 4, 1);
    expect(at(inked, 8, 4)).toBeLessThan(at(flat, 8, 4));
  });

  it("leaves colour alone when edge strength is zero", () => {
    const out = cartoonPosterize(solid(8, 8, [255, 255, 255]), 4, 0);
    expect(at(out, 4, 4)).toBe(255);
  });

  it("clamps the band count to a usable range", () => {
    // 1 band would divide by zero; 500 would be a no-op pretending to work.
    expect(() => cartoonPosterize(splitEdge(), 1, 0)).not.toThrow();
    expect(() => cartoonPosterize(splitEdge(), 500, 0)).not.toThrow();
  });

  it("is deterministic", () => {
    const a = cartoonPosterize(splitEdge(), 5, 0.8);
    const b = cartoonPosterize(splitEdge(), 5, 0.8);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
});

/** Smooth left-to-right dark-to-light ramp. */
function gradient(w = 32, h = 8): RasterImage {
  const image = createImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = Math.round((x / (w - 1)) * 255);
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  return image;
}

const inkedCount = (img: RasterImage): number => {
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i]! < 128) n++;
  return n;
};

describe("watercolor", () => {
  it("keeps a hard edge rather than washing across it", () => {
    const out = watercolor(splitEdge(), 2, 1, 0);
    expect(at(out, 2, 4)).toBeLessThan(90);
    expect(at(out, 13, 4)).toBeGreaterThan(170);
  });

  it("darkens the edge into a dried rim", () => {
    const plain = watercolor(splitEdge(), 2, 0, 0);
    const rimmed = watercolor(splitEdge(), 2, 1, 0);
    // Sample the light side of the boundary, where a rim shows most clearly.
    expect(at(rimmed, 8, 4)).toBeLessThan(at(plain, 8, 4));
  });

  it("is deterministic with grain on", () => {
    const a = watercolor(splitEdge(), 2, 1, 1);
    const b = watercolor(splitEdge(), 2, 1, 1);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it("preserves alpha", () => {
    const image = splitEdge();
    image.data[3] = 0;
    expect(watercolor(image, 2, 1, 0).data[3]).toBe(0);
  });
});

describe("crosshatch", () => {
  it("leaves the lightest tones as bare paper", () => {
    const out = crosshatch(solid(16, 16, [250, 250, 250]), 4, 1);
    expect(inkedCount(out)).toBe(0);
  });

  it("hatches dark tones", () => {
    const out = crosshatch(solid(16, 16, [20, 20, 20]), 4, 1);
    expect(inkedCount(out)).toBeGreaterThan(0);
  });

  it("adds more ink as the tone darkens", () => {
    // A gradient must ink more on its dark end than its light end.
    const out = crosshatch(gradient(64, 16), 4, 1);
    let darkHalf = 0;
    let lightHalf = 0;
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        if (out.data[(y * out.width + x) * 4]! >= 128) continue;
        if (x < out.width / 2) darkHalf++;
        else lightHalf++;
      }
    }
    expect(darkHalf).toBeGreaterThan(lightHalf);
  });

  it("produces only paper and ink, never midtones", () => {
    const out = crosshatch(gradient(), 3, 1);
    const values = new Set<number>();
    for (let i = 0; i < out.data.length; i += 4) values.add(out.data[i]!);
    expect(values.size).toBeLessThanOrEqual(2);
  });

  it("is deterministic", () => {
    const a = crosshatch(gradient(), 4, 1);
    const b = crosshatch(gradient(), 4, 1);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
});

describe("halftone", () => {
  it("grows dots as the tone darkens", () => {
    const dark = halftone(solid(32, 32, [20, 20, 20]), 6, 45);
    const light = halftone(solid(32, 32, [235, 235, 235]), 6, 45);
    expect(inkedCount(dark)).toBeGreaterThan(inkedCount(light));
  });

  it("leaves white as bare paper", () => {
    expect(inkedCount(halftone(solid(24, 24, [255, 255, 255]), 6, 45))).toBe(0);
  });

  it("is a two-tone screen, not a grayscale copy", () => {
    const out = halftone(gradient(48, 16), 5, 45);
    const values = new Set<number>();
    for (let i = 0; i < out.data.length; i += 4) values.add(out.data[i]!);
    expect(values.size).toBeLessThanOrEqual(2);
  });

  it("puts more ink on the dark end of a gradient", () => {
    const out = halftone(gradient(64, 16), 5, 45);
    let dark = 0;
    let light = 0;
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        if (out.data[(y * out.width + x) * 4]! >= 128) continue;
        if (x < out.width / 2) dark++;
        else light++;
      }
    }
    expect(dark).toBeGreaterThan(light);
  });

  it("is deterministic", () => {
    const a = halftone(gradient(), 5, 30);
    const b = halftone(gradient(), 5, 30);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
});
