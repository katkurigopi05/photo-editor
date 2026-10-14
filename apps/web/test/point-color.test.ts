import { describe, expect, it } from "vitest";
import {
  applyPointColor,
  calculatePointColorWeight,
  hueDistance,
  pointHslToRgb,
  pointRgbToHsl,
} from "../src/point-color.js";

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


describe("Point Color Engine", () => {
  it("converts RGB to HSL and back with high fidelity", () => {
    const [h, s, l] = pointRgbToHsl(255, 0, 0); // Pure Red
    expect(h).toBeCloseTo(0, 1);
    expect(s).toBeCloseTo(1, 1);
    expect(l).toBeCloseTo(0.5, 1);

    const [r, g, b] = pointHslToRgb(h, s, l);
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });

  it("calculates hue distance across the 0/360 wrap-around boundary", () => {
    expect(hueDistance(10, 350)).toBe(20);
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(180, 0)).toBe(180);
    expect(hueDistance(45, 55)).toBe(10);
  });

  it("calculates weight matching target color with tolerance and feathering", () => {
    const target = { hue: 120, saturation: 0.8, luminance: 0.5 }; // Pure Green
    const weightExact = calculatePointColorWeight(120, 0.8, 0.5, target);
    expect(weightExact).toBe(1.0);

    const weightFar = calculatePointColorWeight(0, 0.8, 0.5, target); // Red vs Green
    expect(weightFar).toBe(0.0);

    const weightFeathered = calculatePointColorWeight(135, 0.8, 0.5, target, {
      hueTolerance: 10,
      feather: 1.0,
    });
    expect(weightFeathered).toBeGreaterThan(0);
    expect(weightFeathered).toBeLessThan(1);
  });

  it("shifts hue and saturation on selected target colors while leaving others untouched", () => {
    // 2x1 image: left pixel Red [255, 0, 0], right pixel Blue [0, 0, 255]
    const img = makeImageData(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]));

    const result = applyPointColor(img, {
      target: { hue: 0, saturation: 1, luminance: 0.5 }, // Target Red
      adjustment: {
        hueShift: 120, // Shift Red to Green
      },
    });

    // Left pixel shifted toward green
    const leftG = result.data[1];
    expect(leftG).toBeGreaterThan(200);

    // Right pixel (Blue) untouched
    expect(result.data[4]).toBe(0);
    expect(result.data[5]).toBe(0);
    expect(result.data[6]).toBe(255);
  });

  it("renders non-selected pixels in grayscale when visualizeRange is enabled", () => {
    // Left pixel Red, right pixel Blue
    const img = makeImageData(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]));

    const result = applyPointColor(img, {
      target: { hue: 0, saturation: 1, luminance: 0.5 }, // Target Red
      visualizeRange: true,
    });

    // Left pixel (Red) remains colored
    expect(result.data[0]).toBe(255);
    expect(result.data[1]).toBe(0);
    expect(result.data[2]).toBe(0);

    // Right pixel (Blue) is desaturated to grayscale (equal RGB)
    const grayR = result.data[4];
    const grayG = result.data[5];
    const grayB = result.data[6];
    expect(grayR).toBe(grayG);
    expect(grayG).toBe(grayB);
    expect(grayB).toBeCloseTo(Math.round(0.114 * 255), -1);
  });
});
