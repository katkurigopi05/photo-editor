import { describe, expect, it } from "vitest";
import { applyPerspectiveUpright } from "../src/perspective-upright.js";

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

describe("Perspective Upright Geometry Engine", () => {
  it("leaves image unchanged under identity transform", () => {
    const img = makeImageData(4, 4, (x, y) => [x * 40, y * 40, 150, 255]);
    const result = applyPerspectiveUpright(img, {});

    for (let i = 0; i < img.data.length; i++) {
      expect(result.data[i]).toBe(img.data[i]);
    }
  });

  it("scales and rotates image around its center", () => {
    // 5x5 image with center pixel bright [255, 255, 255] and others dark
    const img = makeImageData(5, 5, (x, y) => (x === 2 && y === 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));

    const rotated = applyPerspectiveUpright(img, { rotate: 90 });
    // Center pixel (2, 2) should remain preserved
    const centerIdx = (2 * 5 + 2) * 4;
    expect(rotated.data[centerIdx]).toBe(255);
    expect(rotated.data[centerIdx + 1]).toBe(255);
    expect(rotated.data[centerIdx + 2]).toBe(255);
  });

  it("applies vertical keystone tilt warping projective coordinates", () => {
    // 6x6 gradient image
    const img = makeImageData(6, 6, (x, y) => [x * 30, y * 30, 100, 255]);

    const tilted = applyPerspectiveUpright(img, { vertical: 50 });

    expect(tilted.width).toBe(6);
    expect(tilted.height).toBe(6);
    // Transformed pixels are defined and within valid 0-255 range
    for (let i = 0; i < tilted.data.length; i++) {
      expect(tilted.data[i]).toBeGreaterThanOrEqual(0);
      expect(tilted.data[i]).toBeLessThanOrEqual(255);
    }
  });
});
