import { describe, expect, it } from "vitest";
import {
  chroma,
  chromaCentre,
  clippedFraction,
  histogram,
  luma,
  vectorscope,
  waveform,
} from "../src/scopes.js";

/**
 * Video scopes.
 *
 * A scope that is merely plausible is worse than none: it makes a wrong grade
 * feel measured. So these check against colours whose answers are known in
 * advance — pure primaries, flat greys, a deliberately clipped frame — rather
 * than against whatever the code happened to produce.
 */

/** A frame of one repeated colour. */
function flat(
  width: number,
  height: number,
  [r, g, b, a]: [number, number, number, number],
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = a;
  }
  return pixels;
}

/** A frame split down the middle: left colour, right colour. */
function split(
  width: number,
  height: number,
  left: [number, number, number, number],
  right: [number, number, number, number],
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = x < width / 2 ? left : right;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = a;
    }
  }
  return pixels;
}

describe("luma", () => {
  it("weights green most and blue least, per Rec. 709", () => {
    expect(luma(255, 0, 0)).toBeCloseTo(54.2, 1);
    expect(luma(0, 255, 0)).toBeCloseTo(182.4, 1);
    expect(luma(0, 0, 255)).toBeCloseTo(18.4, 1);
  });

  it("puts white at full and black at zero", () => {
    expect(luma(255, 255, 255)).toBeCloseTo(255, 5);
    expect(luma(0, 0, 0)).toBe(0);
  });
});

describe("histogram", () => {
  it("puts a flat grey frame in exactly one bin", () => {
    const bins = histogram(flat(8, 8, [128, 128, 128, 255]));
    expect(bins.total).toBe(64);
    expect(bins.red[128]).toBe(64);
    expect(bins.red.filter((count) => count > 0)).toHaveLength(1);
    expect(bins.luma[128]).toBe(64);
  });

  it("separates the channels", () => {
    const bins = histogram(flat(4, 4, [200, 100, 50, 255]));
    expect(bins.red[200]).toBe(16);
    expect(bins.green[100]).toBe(16);
    expect(bins.blue[50]).toBe(16);
  });

  it("ignores fully transparent pixels", () => {
    // A keyed-out background is not part of the picture being graded; counting
    // it puts a false spike at zero and makes every clipping call wrong.
    const bins = histogram(flat(4, 4, [0, 0, 0, 0]));
    expect(bins.total).toBe(0);
    expect(bins.red[0]).toBe(0);
  });

  it("samples every nth pixel when asked", () => {
    const bins = histogram(flat(10, 10, [64, 64, 64, 255]), 5);
    expect(bins.total).toBe(20);
  });
});

describe("clippedFraction", () => {
  it("reports a frame crushed to black and one blown to white", () => {
    const black = histogram(flat(4, 4, [0, 0, 0, 255]));
    expect(clippedFraction(black.luma, black.total).black).toBe(1);
    const white = histogram(flat(4, 4, [255, 255, 255, 255]));
    expect(clippedFraction(white.luma, white.total).white).toBe(1);
  });

  it("reports nothing clipped for a mid-grey frame", () => {
    const bins = histogram(flat(4, 4, [128, 128, 128, 255]));
    expect(clippedFraction(bins.luma, bins.total)).toEqual({
      black: 0,
      white: 0,
    });
  });

  it("survives an empty count", () => {
    expect(clippedFraction([], 0)).toEqual({ black: 0, white: 0 });
  });
});

describe("waveform", () => {
  it("keeps left-right geometry, which is the whole point of it", () => {
    // A histogram cannot tell a blown sky from a blown face; a waveform can,
    // because the bright pixels stay where they were in the frame.
    const pixels = split(
      16,
      4,
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    );
    // Four columns over sixteen pixels of width, four rows tall: sixteen
    // pixels land in each column.
    const scope = waveform(pixels, 16, 4, 4);
    expect(scope.columns[0]![0]).toBe(16);
    expect(scope.columns[0]![255]).toBe(0);
    expect(scope.columns[3]![255]).toBe(16);
    expect(scope.columns[3]![0]).toBe(0);
  });

  it("reports the densest bucket so a drawing can normalise", () => {
    const scope = waveform(flat(8, 8, [128, 128, 128, 255]), 8, 8, 8);
    expect(scope.peak).toBe(8);
  });

  it("skips transparent pixels", () => {
    const scope = waveform(flat(8, 8, [255, 255, 255, 0]), 8, 8, 4);
    expect(scope.peak).toBe(0);
  });
});

describe("chroma and the vectorscope", () => {
  it("puts grey at the centre, whatever its brightness", () => {
    for (const level of [0, 64, 128, 200, 255]) {
      const { u, v } = chroma(level, level, level);
      expect(u).toBeCloseTo(0, 6);
      expect(v).toBeCloseTo(0, 6);
    }
  });

  it("collapses a grey frame to a single point at the centre", () => {
    const scope = vectorscope(flat(8, 8, [128, 128, 128, 255]), 33);
    const centre = 16 * 33 + 16;
    expect(scope.grid[centre]).toBe(64);
    expect(scope.maxSaturation).toBeCloseTo(0, 6);
  });

  it("pushes a saturated primary well out from the centre", () => {
    const red = vectorscope(flat(4, 4, [255, 0, 0, 255]));
    expect(red.maxSaturation).toBeGreaterThan(0.7);
  });

  it("separates red from blue by direction, not just distance", () => {
    // Red is positive V, blue is positive U — opposite quadrants, which is what
    // makes hue readable as an angle.
    const red = chroma(255, 0, 0);
    const blue = chroma(0, 0, 255);
    expect(red.v).toBeGreaterThan(0);
    expect(blue.u).toBeGreaterThan(0);
    expect(blue.v).toBeLessThan(0);
  });
});

describe("chromaCentre", () => {
  it("reads zero on neutral footage", () => {
    expect(chromaCentre(flat(8, 8, [90, 90, 90, 255])).distance).toBeCloseTo(
      0,
      6,
    );
  });

  it("reads a warm cast as a real distance", () => {
    const warm = chromaCentre(flat(8, 8, [150, 120, 90, 255]));
    expect(warm.distance).toBeGreaterThan(10);
    // Warm means red-leaning: positive V, negative U.
    expect(warm.v).toBeGreaterThan(0);
    expect(warm.u).toBeLessThan(0);
  });

  it("survives a fully transparent frame", () => {
    expect(chromaCentre(flat(4, 4, [10, 20, 30, 0]))).toEqual({
      u: 0,
      v: 0,
      distance: 0,
    });
  });
});
