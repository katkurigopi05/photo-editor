import { describe, expect, it } from "vitest";
import { createImage, pixelIndex, type RasterImage } from "../src/types.js";
import { whiteBalance, levels, toneCurve, vibrance } from "../src/grade.js";

/**
 * Colour grading is the one part of the effect stack a photographer judges by
 * eye, so the tests pin the properties that make a grade trustworthy rather
 * than exact pixel values: neutral parameters are exact no-ops, the controls
 * move the channel they claim to move, alpha is never touched, and every pass
 * is deterministic (the same input grades identically on every exported frame).
 */

/** A patch of one solid colour, fully opaque. */
function solid(r: number, g: number, b: number, a = 255): RasterImage {
  const image = createImage(2, 2);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = r;
    image.data[i + 1] = g;
    image.data[i + 2] = b;
    image.data[i + 3] = a;
  }
  return image;
}

/** A horizontal black-to-white ramp. */
function ramp(width = 16): RasterImage {
  const image = createImage(width, 1);
  for (let x = 0; x < width; x++) {
    const p = pixelIndex(x, 0, width);
    const v = Math.round((x / (width - 1)) * 255);
    image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
    image.data[p + 3] = 255;
  }
  return image;
}

const rgbAt = (image: RasterImage, x: number): [number, number, number] => {
  const p = pixelIndex(x, 0, image.width);
  return [image.data[p]!, image.data[p + 1]!, image.data[p + 2]!];
};

describe("whiteBalance", () => {
  it("is an exact no-op at neutral temperature and tint", () => {
    const image = solid(90, 120, 200);
    const out = whiteBalance(image, 0, 0);
    expect(Array.from(out.data)).toEqual(Array.from(image.data));
  });

  it("warms by lifting red and dropping blue", () => {
    const [r, g, b] = rgbAt(whiteBalance(solid(128, 128, 128), 0.5, 0), 0);
    expect(r).toBeGreaterThan(128);
    expect(b).toBeLessThan(128);
    expect(g).toBe(128);
  });

  it("cools by dropping red and lifting blue", () => {
    const [r, g, b] = rgbAt(whiteBalance(solid(128, 128, 128), -0.5, 0), 0);
    expect(r).toBeLessThan(128);
    expect(b).toBeGreaterThan(128);
    expect(g).toBe(128);
  });

  it("moves tint on the green/magenta axis only", () => {
    const green = rgbAt(whiteBalance(solid(128, 128, 128), 0, 0.5), 0);
    expect(green[1]).toBeGreaterThan(128);
    expect(green[0]).toBeLessThan(128);
    expect(green[2]).toBeLessThan(128);

    const magenta = rgbAt(whiteBalance(solid(128, 128, 128), 0, -0.5), 0);
    expect(magenta[1]).toBeLessThan(128);
    expect(magenta[0]).toBeGreaterThan(128);
    expect(magenta[2]).toBeGreaterThan(128);
  });

  it("keeps pure black and pure white in range", () => {
    const black = rgbAt(whiteBalance(solid(0, 0, 0), 1, 1), 0);
    const white = rgbAt(whiteBalance(solid(255, 255, 255), 1, 1), 0);
    for (const v of [...black, ...white]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it("leaves alpha untouched", () => {
    const image = solid(200, 30, 30, 77);
    const out = whiteBalance(image, 1, -1);
    expect(out.data[3]).toBe(77);
  });

  it("does not mutate its input", () => {
    const image = solid(128, 128, 128);
    const before = Array.from(image.data);
    whiteBalance(image, 0.8, 0.3);
    expect(Array.from(image.data)).toEqual(before);
  });
});

describe("levels", () => {
  it("is an exact no-op at the full range with gamma 1", () => {
    const image = ramp();
    const out = levels(image, 0, 1, 1);
    expect(Array.from(out.data)).toEqual(Array.from(image.data));
  });

  it("clips everything below the black point to black", () => {
    const out = levels(ramp(), 0.5, 1, 1);
    expect(rgbAt(out, 0)).toEqual([0, 0, 0]);
    // 0.4 of the ramp is still under the black point.
    expect(rgbAt(out, 6)[0]).toBe(0);
  });

  it("clips everything above the white point to white", () => {
    const out = levels(ramp(), 0, 0.5, 1);
    expect(rgbAt(out, 15)).toEqual([255, 255, 255]);
    expect(rgbAt(out, 9)[0]).toBe(255);
  });

  it("stretches the surviving range across the full 0-255 span", () => {
    const out = levels(ramp(), 0.25, 0.75, 1);
    expect(rgbAt(out, 0)[0]).toBe(0);
    expect(rgbAt(out, 15)[0]).toBe(255);
    // The midpoint of the input window lands at the midpoint of the output.
    const mid = rgbAt(out, 8)[0];
    expect(mid).toBeGreaterThan(120);
    expect(mid).toBeLessThan(160);
  });

  it("brightens midtones with gamma above 1 and darkens below 1", () => {
    const brighter = rgbAt(levels(ramp(), 0, 1, 2), 8)[0];
    const darker = rgbAt(levels(ramp(), 0, 1, 0.5), 8)[0];
    const neutral = rgbAt(ramp(), 8)[0];
    expect(brighter).toBeGreaterThan(neutral);
    expect(darker).toBeLessThan(neutral);
    // Gamma is a midtone control: the endpoints stay pinned.
    expect(rgbAt(levels(ramp(), 0, 1, 2), 0)[0]).toBe(0);
    expect(rgbAt(levels(ramp(), 0, 1, 2), 15)[0]).toBe(255);
  });

  it("survives an inverted window without dividing by zero", () => {
    // black >= white is rejected by the schema, but the pass must not produce
    // NaN if it is ever reached with degenerate values.
    const out = levels(ramp(), 0.5, 0.5, 1);
    for (const v of out.data) expect(Number.isFinite(v)).toBe(true);
  });

  it("leaves alpha untouched", () => {
    const out = levels(solid(10, 20, 30, 44), 0.1, 0.9, 1.5);
    expect(out.data[3]).toBe(44);
  });
});

describe("toneCurve", () => {
  it("is an exact no-op at zero for all three bands", () => {
    const image = ramp();
    const out = toneCurve(image, 0, 0, 0);
    expect(Array.from(out.data)).toEqual(Array.from(image.data));
  });

  it("lifts shadows without blowing out highlights", () => {
    const out = toneCurve(ramp(), 0.8, 0, 0);
    const shadow = rgbAt(out, 2)[0];
    const highlight = rgbAt(out, 14)[0];
    expect(shadow).toBeGreaterThan(rgbAt(ramp(), 2)[0]);
    // The highlight band moves far less than the shadow band it targets.
    expect(highlight - rgbAt(ramp(), 14)[0]).toBeLessThan(
      shadow - rgbAt(ramp(), 2)[0],
    );
  });

  it("pulls highlights down without crushing shadows", () => {
    const out = toneCurve(ramp(), 0, 0, -0.8);
    const shadowDelta = rgbAt(ramp(), 2)[0] - rgbAt(out, 2)[0];
    const highlightDelta = rgbAt(ramp(), 14)[0] - rgbAt(out, 14)[0];
    expect(highlightDelta).toBeGreaterThan(0);
    expect(highlightDelta).toBeGreaterThan(shadowDelta);
  });

  it("moves midtones most in the middle of the ramp", () => {
    const out = toneCurve(ramp(), 0, 0.8, 0);
    const deltaAt = (x: number): number =>
      rgbAt(out, x)[0] - rgbAt(ramp(), x)[0];
    expect(deltaAt(8)).toBeGreaterThan(deltaAt(1));
    expect(deltaAt(8)).toBeGreaterThan(deltaAt(14));
  });

  it("stays inside 0-255 at extreme settings", () => {
    for (const value of [-1, 1]) {
      const out = toneCurve(ramp(), value, value, value);
      for (const v of out.data) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });

  it("is monotonic, so it never inverts tonal order", () => {
    const out = toneCurve(ramp(64), 0.6, -0.4, 0.5);
    for (let x = 1; x < out.width; x++) {
      expect(rgbAt(out, x)[0]).toBeGreaterThanOrEqual(rgbAt(out, x - 1)[0]);
    }
  });

  it("leaves alpha untouched", () => {
    const out = toneCurve(solid(10, 20, 30, 44), 1, 1, 1);
    expect(out.data[3]).toBe(44);
  });
});

describe("vibrance", () => {
  it("is an exact no-op at amount 0", () => {
    const image = solid(200, 60, 40);
    const out = vibrance(image, 0);
    expect(Array.from(out.data)).toEqual(Array.from(image.data));
  });

  it("leaves a neutral gray untouched at any amount", () => {
    // Saturating a gray must not invent a colour cast.
    expect(rgbAt(vibrance(solid(128, 128, 128), 1), 0)).toEqual([
      128, 128, 128,
    ]);
    expect(rgbAt(vibrance(solid(128, 128, 128), -1), 0)).toEqual([
      128, 128, 128,
    ]);
  });

  it("boosts a muted colour more than an already saturated one", () => {
    const muted = solid(140, 128, 128); // barely off-gray
    const vivid = solid(255, 0, 0); // fully saturated
    const mutedGain =
      rgbAt(vibrance(muted, 1), 0)[0] - rgbAt(vibrance(muted, 0), 0)[0];
    const vividGain =
      rgbAt(vibrance(vivid, 1), 0)[0] - rgbAt(vibrance(vivid, 0), 0)[0];
    expect(mutedGain).toBeGreaterThan(vividGain);
  });

  it("desaturates toward gray at a negative amount", () => {
    const out = rgbAt(vibrance(solid(200, 60, 40), -1), 0);
    const spreadBefore = 200 - 40;
    const spreadAfter = Math.max(...out) - Math.min(...out);
    expect(spreadAfter).toBeLessThan(spreadBefore);
  });

  it("stays inside 0-255 at full boost", () => {
    const out = vibrance(solid(250, 10, 5), 1);
    for (const v of out.data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it("leaves alpha untouched", () => {
    const out = vibrance(solid(200, 60, 40, 12), 1);
    expect(out.data[3]).toBe(12);
  });

  it("is deterministic across repeated calls", () => {
    const image = ramp();
    const first = Array.from(vibrance(image, 0.7).data);
    for (let i = 0; i < 3; i++) {
      expect(Array.from(vibrance(image, 0.7).data)).toEqual(first);
    }
  });
});
