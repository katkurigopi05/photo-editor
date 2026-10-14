import { describe, expect, it } from "vitest";
import { applyDefringe, isHueInRange } from "../src/defringe.js";

function makeImageData(
  width: number,
  height: number,
  filler: (x: number, y: number) => [number, number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [r, g, b, a] = filler(x, y);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  if (typeof ImageData !== "undefined") {
    return new ImageData(data as unknown as Uint8ClampedArray<ArrayBuffer>, width, height);
  }
  return { data, width, height } as unknown as ImageData;
}

describe("Optics Defringe Engine", () => {
  it("accurately tests whether hues fall within defined bounds", () => {
    expect(isHueInRange(290, [260, 330])).toBe(true);
    expect(isHueInRange(120, [260, 330])).toBe(false);
    expect(isHueInRange(355, [350, 10])).toBe(true);
    expect(isHueInRange(5, [350, 10])).toBe(true);
    expect(isHueInRange(50, [350, 10])).toBe(false);
  });

  it("suppresses purple fringing along high-contrast edges", () => {
    // 3x3 image: middle column is purple fringe [180, 50, 220] between dark and bright
    const img = makeImageData(3, 3, (x) => {
      if (x === 0) return [20, 20, 20, 255]; // Dark background
      if (x === 1) return [180, 50, 220, 255]; // Purple fringing edge (~290 deg)
      return [240, 240, 240, 255]; // Bright sky
    });

    const defringed = applyDefringe(img, {
      purpleAmount: 100, // Full suppression
      purpleHueRange: [260, 330],
      edgeThreshold: 0.1,
    });

    // Middle pixel (1, 1): purple saturation should be neutralized
    const fringeIdx = (1 * 3 + 1) * 4;
    const r = defringed.data[fringeIdx] ?? 0;
    const g = defringed.data[fringeIdx + 1] ?? 0;
    const b = defringed.data[fringeIdx + 2] ?? 0;

    // Channels should be much closer to grayscale / neutral
    const maxDiff = Math.max(Math.abs(r - g), Math.abs(r - b), Math.abs(g - b));
    expect(maxDiff).toBeLessThan(40);
  });

  it("leaves non-fringe colors (e.g. orange / yellow) untouched", () => {
    // Warm orange pixel [240, 140, 30] (Hue ~30 deg)
    const img = makeImageData(1, 1, () => [240, 140, 30, 255]);

    const result = applyDefringe(img, {
      purpleAmount: 100,
      greenAmount: 100,
    });

    expect(result.data[0]).toBe(240);
    expect(result.data[1]).toBe(140);
    expect(result.data[2]).toBe(30);
  });
});
