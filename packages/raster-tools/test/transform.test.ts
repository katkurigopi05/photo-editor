import { describe, expect, it } from "vitest";
import { createImage, pixelIndex } from "../src/types.js";
import {
  cropImage,
  resizeImage,
  rotateImage,
  shiftImage,
} from "../src/transform.js";

describe("cropImage", () => {
  it("extracts the requested rect", () => {
    const image = createImage(10, 10);
    const p = pixelIndex(5, 5, 10);
    image.data[p] = 42;
    image.data[p + 3] = 255;
    const out = cropImage(image, { x: 4, y: 4, width: 4, height: 4 });
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    const q = pixelIndex(1, 1, 4); // (5,5) maps to (1,1) after cropping from (4,4)
    expect(out.data[q]).toBe(42);
  });

  it("fills out-of-bounds regions with transparent black", () => {
    const image = createImage(4, 4);
    const out = cropImage(image, { x: -2, y: -2, width: 4, height: 4 });
    expect(out.data[0]).toBe(0);
  });
});

describe("resizeImage", () => {
  it("produces the requested dimensions", () => {
    const image = createImage(4, 4);
    const out = resizeImage(image, 8, 2);
    expect(out.width).toBe(8);
    expect(out.height).toBe(2);
  });

  it("preserves a uniform color", () => {
    const image = createImage(4, 4);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = 10;
      image.data[i + 1] = 20;
      image.data[i + 2] = 30;
      image.data[i + 3] = 255;
    }
    const out = resizeImage(image, 8, 8);
    const p = pixelIndex(4, 4, 8);
    expect(out.data[p]).toBe(10);
    expect(out.data[p + 1]).toBe(20);
    expect(out.data[p + 2]).toBe(30);
  });
});

describe("rotateImage", () => {
  it("keeps the same footprint at 0 degrees", () => {
    const image = createImage(6, 4);
    const out = rotateImage(image, 0);
    expect(out.width).toBe(6);
    expect(out.height).toBe(4);
  });

  it("swaps width/height at 90 degrees", () => {
    const image = createImage(6, 4);
    const out = rotateImage(image, 90);
    expect(out.width).toBe(4);
    expect(out.height).toBe(6);
  });
});

describe("shiftImage", () => {
  it("moves content and leaves the vacated area transparent", () => {
    const image = createImage(4, 4);
    const p = pixelIndex(0, 0, 4);
    image.data[p] = 99;
    image.data[p + 3] = 255;
    const out = shiftImage(image, 2, 0);
    const moved = pixelIndex(2, 0, 4);
    expect(out.data[moved]).toBe(99);
    expect(out.data[p + 3]).toBe(0); // original spot now transparent
  });
});
