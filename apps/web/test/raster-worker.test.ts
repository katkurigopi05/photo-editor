import { describe, expect, it } from "vitest";
import {
  type RasterImage,
  createImage,
  oilPainting,
  pencilSketch,
  cartoonPosterize,
  clarity,
  texture,
  dehaze,
  unsharpMask,
  noiseReduction,
} from "@director/raster-tools";
import {
  executeRasterOperation,
  type RasterWorkerOperation,
} from "../src/raster-worker.js";
import { RasterWorkerClient } from "../src/raster-worker-client.js";

function makeTestGradient(w = 64, h = 64): RasterImage {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      img.data[idx] = Math.floor((x / w) * 255);
      img.data[idx + 1] = Math.floor((y / h) * 255);
      img.data[idx + 2] = Math.floor(((x + y) / (w + h)) * 255);
      img.data[idx + 3] = 255;
    }
  }
  return img;
}

describe("Raster Worker Operations", () => {
  it("maintains bit-exact parity for oilPainting", () => {
    const input = makeTestGradient(32, 32);
    const expected = oilPainting(input, 3);
    const actual = executeRasterOperation("oilPainting", input, {
      radiusPx: 3,
    });

    expect(actual.width).toBe(expected.width);
    expect(actual.height).toBe(expected.height);
    expect(actual.data).toEqual(expected.data);
  });

  it("maintains bit-exact parity for pencilSketch", () => {
    const input = makeTestGradient(32, 32);
    const expected = pencilSketch(input, 0.8, 0.2);
    const actual = executeRasterOperation("pencilSketch", input, {
      strength: 0.8,
      grain: 0.2,
    });

    expect(actual.width).toBe(expected.width);
    expect(actual.height).toBe(expected.height);
    expect(actual.data).toEqual(expected.data);
  });

  it("maintains bit-exact parity for cartoonPosterize", () => {
    const input = makeTestGradient(32, 32);
    const expected = cartoonPosterize(input, 6, 0.7);
    const actual = executeRasterOperation("cartoonPosterize", input, {
      levels: 6,
      edgeStrength: 0.7,
    });

    expect(actual.data).toEqual(expected.data);
  });

  it("maintains bit-exact parity for clarity", () => {
    const input = makeTestGradient(32, 32);
    const expected = clarity(input, 45);
    const actual = executeRasterOperation("clarity", input, { amount: 45 });

    expect(actual.data).toEqual(expected.data);
  });

  it("maintains bit-exact parity for texture and dehaze", () => {
    const input = makeTestGradient(32, 32);
    const expectedTex = texture(input, 30);
    const actualTex = executeRasterOperation("texture", input, { amount: 30 });
    expect(actualTex.data).toEqual(expectedTex.data);

    const expectedDehaze = dehaze(input, -25);
    const actualDehaze = executeRasterOperation("dehaze", input, { amount: -25 });
    expect(actualDehaze.data).toEqual(expectedDehaze.data);
  });

  it("maintains bit-exact parity for unsharpMask and noiseReduction", () => {
    const input = makeTestGradient(32, 32);
    const expectedUSM = unsharpMask(input, 1.2, 2);
    const actualUSM = executeRasterOperation("unsharpMask", input, {
      amount: 1.2,
      radiusPx: 2,
    });
    expect(actualUSM.data).toEqual(expectedUSM.data);

    const expectedNR = noiseReduction(input, 35, 40);
    const actualNR = executeRasterOperation("noiseReduction", input, {
      luminance: 35,
      chrominance: 40,
    });
    expect(actualNR.data).toEqual(expectedNR.data);
  });

  it("throws a descriptive error for invalid operation", () => {
    const input = makeTestGradient(16, 16);
    expect(() =>
      executeRasterOperation(
        "nonExistentOp" as unknown as RasterWorkerOperation,
        input,
      ),
    ).toThrow("Unsupported raster worker operation");
  });
});

describe("RasterWorkerClient", () => {
  it("executes operations synchronously when Worker is absent in Node environment", async () => {
    const client = new RasterWorkerClient();
    const input = makeTestGradient(32, 32);

    const result = await client.run("clarity", input, {
      params: { amount: 50 },
    });

    expect(result.width).toBe(32);
    expect(result.height).toBe(32);
    expect(result.data.length).toBe(32 * 32 * 4);
    expect(result.data).toEqual(clarity(input, 50).data);
  });

  it("rejects immediately if an AbortSignal is already aborted", async () => {
    const client = new RasterWorkerClient();
    const input = makeTestGradient(16, 16);
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.run("texture", input, { signal: controller.signal }),
    ).rejects.toThrow("Raster operation was aborted");
  });
});
