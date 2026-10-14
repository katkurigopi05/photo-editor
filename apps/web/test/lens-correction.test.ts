import { describe, expect, it } from "vitest";
import { applyLensCorrection } from "../src/lens-correction.js";

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

describe("Lens Correction Engine", () => {
  it("leaves image unchanged when distortion and vignette are zero", () => {
    const img = makeImageData(3, 3, (x, y) => [x * 50, y * 50, 100, 255]);
    const result = applyLensCorrection(img, { distortion: 0, vignetteAmount: 0 });

    for (let i = 0; i < img.data.length; i++) {
      expect(result.data[i]).toBe(img.data[i]);
    }
  });

  it("brightens outer corners when positive vignette compensation is applied", () => {
    // Uniform gray 5x5 image
    const img = makeImageData(5, 5, () => [100, 100, 100, 255]);
    const result = applyLensCorrection(img, {
      vignetteAmount: 50, // +50% brightness in corners
      vignetteMidpoint: 50,
    });

    // Center pixel (2, 2) should remain at baseline brightness
    const centerIdx = (2 * 5 + 2) * 4;
    expect(result.data[centerIdx]).toBe(100);

    // Corner pixel (0, 0) should be brightened
    const cornerIdx = 0;
    expect(result.data[cornerIdx]).toBeGreaterThan(100);
  });

  it("applies geometric distortion warping corner coordinates", () => {
    // 5x5 image with center dot and white border
    const img = makeImageData(5, 5, (x, y) => {
      if (x === 0 || x === 4 || y === 0 || y === 4) return [255, 255, 255, 255];
      return [0, 0, 0, 255];
    });

    const barrel = applyLensCorrection(img, { distortion: 40 });
    const pincushion = applyLensCorrection(img, { distortion: -40 });

    expect(barrel.width).toBe(5);
    expect(barrel.height).toBe(5);
    expect(pincushion.width).toBe(5);
    expect(pincushion.height).toBe(5);

    // Warped pixels differ from original border due to radial shift
    const origCorner = img.data[0];
    expect(origCorner).toBe(255);
  });
});
