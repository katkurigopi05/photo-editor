import { describe, expect, it } from "vitest";
import { createImage } from "@director/raster-tools";
import { preprocessU2Net, U2NET_MEAN, U2NET_STD } from "../src/preprocess.js";

describe("preprocessU2Net", () => {
  it("produces a [1,3,size,size] CHW float tensor", () => {
    const image = createImage(8, 8);
    const out = preprocessU2Net(image, 4);
    expect(out.length).toBe(3 * 4 * 4);
  });

  it("normalizes a known pixel value with the exact ImageNet mean/std", () => {
    const image = createImage(4, 4);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = 255; // pure red
      image.data[i + 1] = 0;
      image.data[i + 2] = 0;
      image.data[i + 3] = 255;
    }
    const out = preprocessU2Net(image, 4);
    const plane = 4 * 4;
    // R channel: (1.0 - mean_r) / std_r
    const expectedR = (1 - U2NET_MEAN[0]) / U2NET_STD[0];
    const expectedG = (0 - U2NET_MEAN[1]) / U2NET_STD[1];
    const expectedB = (0 - U2NET_MEAN[2]) / U2NET_STD[2];
    expect(out[0]).toBeCloseTo(expectedR, 5);
    expect(out[plane]).toBeCloseTo(expectedG, 5);
    expect(out[2 * plane]).toBeCloseTo(expectedB, 5);
  });

  it("resizes non-square input to the square model input size", () => {
    const image = createImage(10, 20);
    const out = preprocessU2Net(image, 6);
    expect(out.length).toBe(3 * 6 * 6);
  });
});
