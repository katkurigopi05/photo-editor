import { describe, expect, it } from "vitest";
import { demosaicBilinear, srgbEncode, toRgba } from "../src/demosaic.js";

/**
 * Demosaicing.
 *
 * The strongest check here is the flat-field one: a scene of constant colour
 * must come back as that colour at every pixel, including the edges. It catches
 * a wrong CFA phase, a bad neighbour search, and an edge case that silently
 * halves a channel — all of which produce a picture that still looks like a
 * picture.
 */

const rggb = (width: number, height: number) => ({
  width,
  height,
  cfaPattern: ["R", "G", "G", "B"] as ("R" | "G" | "B")[],
  cfaRepeat: { cols: 2, rows: 2 },
});

/** Build a CFA frame from a flat RGB colour: each site records only its own
 * channel, which is exactly what a sensor does. */
function flatField(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  pattern = ["R", "G", "G", "B"] as ("R" | "G" | "B")[],
): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const c = pattern[(y % 2) * 2 + (x % 2)]!;
      out[y * width + x] = c === "R" ? r : c === "G" ? g : b;
    }
  }
  return out;
}

describe("demosaicBilinear", () => {
  it("refuses an image with no CFA pattern", () => {
    expect(
      demosaicBilinear(new Float32Array(16), { ...rggb(4, 4), cfaPattern: [] }),
    ).toBeNull();
  });

  it("refuses a sample buffer smaller than the image", () => {
    // Better to decline than to read zeros and produce a picture with a black
    // band nobody asked about.
    expect(demosaicBilinear(new Float32Array(4), rggb(4, 4))).toBeNull();
  });

  it("reproduces a flat colour everywhere, edges included", () => {
    // The load-bearing test. Every pixel of a constant scene must come back as
    // that constant — a wrong phase, a missed neighbour, or an edge that
    // averages against nothing all show up here.
    const w = 8;
    const h = 8;
    const out = demosaicBilinear(flatField(w, h, 0.2, 0.5, 0.8), rggb(w, h))!;
    for (let p = 0; p < w * h; p += 1) {
      expect(out.rgb[p * 3]).toBeCloseTo(0.2, 5);
      expect(out.rgb[p * 3 + 1]).toBeCloseTo(0.5, 5);
      expect(out.rgb[p * 3 + 2]).toBeCloseTo(0.8, 5);
    }
  });

  it("reproduces a flat colour under a different CFA phase", () => {
    // Four Bayer phases exist and sensors use all of them. Hard-coding one is
    // right a quarter of the time and swaps red for blue the rest.
    const pattern = ["B", "G", "G", "R"] as ("R" | "G" | "B")[];
    const w = 6;
    const h = 6;
    const out = demosaicBilinear(flatField(w, h, 0.9, 0.4, 0.1, pattern), {
      ...rggb(w, h),
      cfaPattern: pattern,
    })!;
    for (let p = 0; p < w * h; p += 1) {
      expect(out.rgb[p * 3]).toBeCloseTo(0.9, 5);
      expect(out.rgb[p * 3 + 2]).toBeCloseTo(0.1, 5);
    }
  });

  it("keeps the measured channel exactly, without blurring it", () => {
    // The one number at each position that is not a guess.
    const w = 4;
    const h = 4;
    const samples = flatField(w, h, 0.25, 0.5, 0.75);
    samples[0] = 0.99; // an R site
    const out = demosaicBilinear(samples, rggb(w, h))!;
    expect(out.rgb[0]).toBeCloseTo(0.99, 6);
  });

  it("interpolates a missing channel from its neighbours", () => {
    // At (0,0) — an R site on RGGB — green is measured at (1,0) and (0,1).
    const w = 4;
    const h = 4;
    const samples = flatField(w, h, 0.1, 0.5, 0.9);
    samples[1] = 0.4; // green at (1,0)
    samples[w] = 0.6; // green at (0,1)
    const out = demosaicBilinear(samples, rggb(w, h))!;
    expect(out.rgb[1]).toBeCloseTo(0.5, 5);
  });

  it("gives every pixel all three channels, with none left at zero", () => {
    // A missing neighbour search shows up as isolated black pixels rather than
    // as a soft error, so this checks the whole frame rather than a sample.
    const w = 5;
    const h = 5;
    const out = demosaicBilinear(flatField(w, h, 0.3, 0.3, 0.3), rggb(w, h))!;
    for (let i = 0; i < out.rgb.length; i += 1) {
      expect(out.rgb[i]).toBeGreaterThan(0);
    }
  });

  it("copes with an image too small to hold a full pattern", () => {
    // Degenerate, but it must not divide by zero or punch a hole.
    const out = demosaicBilinear(new Float32Array([0.5]), rggb(1, 1));
    expect(out).not.toBeNull();
    expect([...out!.rgb]).toEqual([0.5, 0.5, 0.5]);
  });
});

describe("srgbEncode", () => {
  it("maps the ends exactly", () => {
    expect(srgbEncode(0)).toBe(0);
    expect(srgbEncode(1)).toBeCloseTo(1, 6);
  });

  it("lifts midtones, which is the point of applying it", () => {
    // Linear 0.5 is not mid-grey on a display; writing it straight through is
    // what makes an unconverted raw look far too dark.
    expect(srgbEncode(0.5)).toBeGreaterThan(0.7);
  });

  it("is linear near black rather than infinitely steep", () => {
    expect(srgbEncode(0.001)).toBeCloseTo(0.001 * 12.92, 6);
  });

  it("clamps out-of-range input", () => {
    expect(srgbEncode(-1)).toBe(0);
    expect(srgbEncode(2)).toBeCloseTo(1, 6);
  });
});

describe("toRgba", () => {
  it("writes four channels per pixel with alpha opaque", () => {
    const out = toRgba({
      width: 2,
      height: 1,
      rgb: new Float32Array([0, 0, 0, 1, 1, 1]),
    });
    expect(out.length).toBe(8);
    expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    expect([...out.slice(4)]).toEqual([255, 255, 255, 255]);
  });

  it("applies the gamma curve rather than scaling linearly", () => {
    // 0.5 linear scaled would be 128; encoded it is nearer 188. Getting this
    // wrong is the difference between a normal photograph and a dark one.
    const out = toRgba({
      width: 1,
      height: 1,
      rgb: new Float32Array([0.5, 0.5, 0.5]),
    });
    expect(out[0]).toBeGreaterThan(180);
    expect(out[0]).toBeLessThan(195);
  });
});

describe("sparse CFA repeats", () => {
  /**
   * A 4×4 repeat with a single red site, so most positions have no red within
   * one step. This is what the widening search exists for.
   *
   * Added after a mutation that removed the widening passed every test — the
   * code comment had claimed Bayer needed it, which is false, so nothing
   * covered the case that actually does.
   */
  const sparse = {
    width: 8,
    height: 8,
    cfaPattern: [
      "R",
      "G",
      "B",
      "G",
      "G",
      "B",
      "G",
      "B",
      "B",
      "G",
      "B",
      "G",
      "G",
      "B",
      "G",
      "B",
    ] as ("R" | "G" | "B")[],
    cfaRepeat: { cols: 4, rows: 4 },
  };

  it("finds a colour two steps away when there is none adjacent", () => {
    // At (2,2) the nearest red is (0,0) or (4,4): Chebyshev distance two. A
    // search that never widens leaves red at zero there, which shows as a
    // scattering of dark pixels rather than as a soft error.
    const samples = new Float32Array(8 * 8);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const c = sparse.cfaPattern[(y % 4) * 4 + (x % 4)]!;
        samples[y * 8 + x] = c === "R" ? 0.8 : c === "G" ? 0.5 : 0.2;
      }
    }
    const out = demosaicBilinear(samples, sparse)!;
    const at = (x: number, y: number, c: number): number =>
      out.rgb[(y * 8 + x) * 3 + c]!;
    expect(at(2, 2, 0)).toBeCloseTo(0.8, 5);
    // And no pixel anywhere is left without red.
    for (let p = 0; p < 64; p += 1) {
      expect(out.rgb[p * 3]).toBeGreaterThan(0);
    }
  });
});
