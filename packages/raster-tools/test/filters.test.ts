import { describe, expect, it } from "vitest";
import { createImage, createMask, pixelIndex } from "../src/types.js";
import {
  unsharpMask,
  diffusionFill,
  colorKeyAlpha,
  cornerKeyColor,
} from "../src/filters.js";

describe("unsharpMask", () => {
  it("is a no-op at amount 0", () => {
    const image = createImage(6, 6);
    for (let i = 0; i < image.data.length; i++) image.data[i] = (i * 7) % 256;
    const out = unsharpMask(image, 0);
    expect(Array.from(out.data)).toEqual(Array.from(image.data));
  });

  it("increases contrast at an edge", () => {
    const image = createImage(6, 1);
    // dark | bright step edge
    for (let x = 0; x < 3; x++) {
      const p = pixelIndex(x, 0, 6);
      image.data[p] = image.data[p + 1] = image.data[p + 2] = 50;
      image.data[p + 3] = 255;
    }
    for (let x = 3; x < 6; x++) {
      const p = pixelIndex(x, 0, 6);
      image.data[p] = image.data[p + 1] = image.data[p + 2] = 200;
      image.data[p + 3] = 255;
    }
    const out = unsharpMask(image, 1, 1);
    // the bright side of the edge should get brighter (overshoot), dark side darker
    const brightNearEdge = out.data[pixelIndex(3, 0, 6)]!;
    expect(brightNearEdge).toBeGreaterThanOrEqual(200);
  });
});

describe("diffusionFill", () => {
  it("fills a masked hole with a value between its boundary neighbors", () => {
    const image = createImage(5, 1);
    const setPixel = (x: number, v: number): void => {
      const p = pixelIndex(x, 0, 5);
      image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
      image.data[p + 3] = 255;
    };
    setPixel(0, 0);
    setPixel(1, 0);
    setPixel(2, 128); // will be masked out
    setPixel(3, 255);
    setPixel(4, 255);

    const mask = createMask(5, 1);
    mask.data[2] = 255;

    const out = diffusionFill(image, mask, 50);
    const filled = out.data[pixelIndex(2, 0, 5)]!;
    // Between the left (0) and right (255) boundary values.
    expect(filled).toBeGreaterThan(0);
    expect(filled).toBeLessThan(255);
  });

  it("is a no-op when the mask is empty", () => {
    const image = createImage(4, 4);
    for (let i = 0; i < image.data.length; i++) image.data[i] = (i * 3) % 256;
    const mask = createMask(4, 4);
    const out = diffusionFill(image, mask, 10);
    expect(Array.from(out.data)).toEqual(Array.from(image.data));
  });
});

describe("colorKeyAlpha", () => {
  it("makes near-key pixels transparent and leaves far pixels opaque", () => {
    const image = createImage(2, 1);
    // pixel 0: pure green (the key); pixel 1: pure red (far from key)
    image.data[0] = 0;
    image.data[1] = 255;
    image.data[2] = 0;
    image.data[3] = 255;
    image.data[4] = 255;
    image.data[5] = 0;
    image.data[6] = 0;
    image.data[7] = 255;

    const out = colorKeyAlpha(image, { r: 0, g: 255, b: 0 }, 0.1, 0.05);
    expect(out.data[3]).toBe(0);
    expect(out.data[7]).toBe(255);
  });
});

describe("cornerKeyColor", () => {
  it("averages the four corner samples", () => {
    const image = createImage(10, 10);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = 100;
      image.data[i + 1] = 150;
      image.data[i + 2] = 200;
      image.data[i + 3] = 255;
    }
    const key = cornerKeyColor(image, 2);
    expect(key).toEqual({ r: 100, g: 150, b: 200 });
  });
});
