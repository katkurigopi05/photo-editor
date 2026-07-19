import { describe, expect, it } from "vitest";
import { createImage, createMask, pixelIndex } from "../src/types.js";
import {
  stampBrush,
  cloneStamp,
  applyMaskDelete,
  applyMaskFill,
} from "../src/paint.js";

function fillOpaque(
  image: ReturnType<typeof createImage>,
  r: number,
  g: number,
  b: number,
): void {
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = r;
    image.data[i + 1] = g;
    image.data[i + 2] = b;
    image.data[i + 3] = 255;
  }
}

describe("stampBrush", () => {
  it("paints full-opacity color at the center, hard edge", () => {
    const image = createImage(20, 20);
    stampBrush(image, 10, 10, 5, { r: 255, g: 0, b: 0, a: 1 }, 1, "paint", 1);
    const p = pixelIndex(10, 10, 20);
    expect(image.data[p]).toBe(255);
    expect(image.data[p + 1]).toBe(0);
    expect(image.data[p + 3]).toBe(255);
  });

  it("leaves pixels outside the radius untouched", () => {
    const image = createImage(20, 20);
    stampBrush(image, 10, 10, 3, { r: 255, g: 0, b: 0, a: 1 }, 1, "paint", 1);
    const far = pixelIndex(19, 19, 20);
    expect(image.data[far]).toBe(0);
    expect(image.data[far + 3]).toBe(0);
  });

  it("erase mode reduces alpha without touching color", () => {
    const image = createImage(20, 20);
    fillOpaque(image, 10, 20, 30);
    stampBrush(image, 10, 10, 5, { r: 0, g: 0, b: 0, a: 1 }, 1, "erase", 1);
    const p = pixelIndex(10, 10, 20);
    expect(image.data[p + 3]).toBe(0);
    expect(image.data[p]).toBe(10); // color channel unchanged by erase
  });

  it("partial opacity blends rather than replaces", () => {
    const image = createImage(4, 4);
    fillOpaque(image, 0, 0, 0);
    stampBrush(
      image,
      2,
      2,
      10,
      { r: 255, g: 255, b: 255, a: 1 },
      0.5,
      "paint",
      1,
    );
    const p = pixelIndex(2, 2, 4);
    expect(image.data[p]).toBeGreaterThan(0);
    expect(image.data[p]).toBeLessThan(255);
  });
});

describe("cloneStamp", () => {
  it("copies the source region to the destination", () => {
    const image = createImage(20, 20);
    // paint a red square at (2,2)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const p = pixelIndex(2 + x, 2 + y, 20);
        image.data[p] = 200;
        image.data[p + 3] = 255;
      }
    }
    const snapshot = {
      width: image.width,
      height: image.height,
      data: new Uint8ClampedArray(image.data),
    };
    cloneStamp(image, snapshot, 3, 3, 15, 15, 2, 1, 1);
    const dest = pixelIndex(15, 15, 20);
    expect(image.data[dest]).toBe(200);
  });
});

describe("applyMaskDelete / applyMaskFill", () => {
  it("delete clears alpha under a full mask, leaves other pixels alone", () => {
    const image = createImage(4, 4);
    fillOpaque(image, 5, 6, 7);
    const mask = createMask(4, 4);
    mask.data[0] = 255; // pixel (0,0)
    applyMaskDelete(image, mask);
    expect(image.data[3]).toBe(0); // alpha of (0,0)
    expect(image.data[4 + 3]).toBe(255); // alpha of (1,0) untouched
  });

  it("fill composites color weighted by mask and color alpha", () => {
    const image = createImage(4, 4);
    fillOpaque(image, 0, 0, 0);
    const mask = createMask(4, 4);
    mask.data[0] = 255;
    applyMaskFill(image, mask, { r: 255, g: 255, b: 255, a: 1 });
    expect(image.data[0]).toBe(255);
    expect(image.data[4]).toBe(0); // (1,0) untouched
  });
});
