import { describe, expect, it } from "vitest";
import { applyLensBlur } from "../src/lens-blur.js";

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

describe("AI Lens Blur and Bokeh Simulator", () => {
  it("keeps pixels within focal range sharp and blurs background", () => {
    // 5x5 image with center point bright
    const img = makeImageData(5, 5, (x, y) => (x === 2 && y === 2 ? [255, 255, 255, 255] : [50, 50, 50, 255]));

    // Custom depth map: center (2, 2) is at depth 0.5 (in focus [0.4, 0.6]), corners at depth 1.0 (out of focus)
    const depthMap = makeImageData(5, 5, (x, y) => {
      const isCenter = x === 2 && y === 2;
      const val = isCenter ? 128 : 255;
      return [val, val, val, 255];
    });

    const blurred = applyLensBlur(img, {
      blurAmount: 5,
      focalRange: [0.4, 0.6],
      bokehShape: "circle",
    }, depthMap);

    // Center pixel is in focus
    const centerIdx = (2 * 5 + 2) * 4;
    expect(blurred.data[centerIdx]).toBe(255);

    // Adjacent pixels have blurred light from center
    const adjIdx = (2 * 5 + 1) * 4;
    expect(blurred.data[adjIdx]).toBeGreaterThan(50);
  });

  it("supports polygonal aperture blades and cat-eye bokeh shapes", () => {
    const img = makeImageData(3, 3, () => [100, 100, 100, 255]);

    const blade5 = applyLensBlur(img, { blurAmount: 4, bokehShape: "blade-5" });
    const catEye = applyLensBlur(img, { blurAmount: 4, bokehShape: "cat-eye" });

    expect(blade5.width).toBe(3);
    expect(catEye.width).toBe(3);
    expect(blade5.data[0]).toBe(100);
    expect(catEye.data[0]).toBe(100);
  });

  it("returns unchanged image when blurAmount is 0", () => {
    const img = makeImageData(2, 2, (x, y) => [x * 100, y * 100, 50, 255]);
    const result = applyLensBlur(img, { blurAmount: 0 });

    for (let i = 0; i < img.data.length; i++) {
      expect(result.data[i]).toBe(img.data[i]);
    }
  });
});
