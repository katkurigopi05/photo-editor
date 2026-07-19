import { describe, expect, it } from "vitest";
import { createImage } from "../src/types.js";
import {
  polygonMask,
  floodFillMask,
  invertMask,
  featherMask,
  maskBounds,
} from "../src/mask.js";

describe("polygonMask", () => {
  it("fills a rectangle", () => {
    const mask = polygonMask(10, 10, [
      { x: 2, y: 2 },
      { x: 7, y: 2 },
      { x: 7, y: 6 },
      { x: 2, y: 6 },
    ]);
    // inside
    expect(mask.data[4 * 10 + 4]).toBe(255);
    // outside
    expect(mask.data[0]).toBe(0);
    expect(mask.data[9 * 10 + 9]).toBe(0);
  });

  it("returns an empty mask for fewer than 3 points", () => {
    const mask = polygonMask(4, 4, [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
    expect(mask.data.every((v) => v === 0)).toBe(true);
  });
});

describe("floodFillMask", () => {
  it("selects only the contiguous region matching the seed color", () => {
    const image = createImage(5, 1);
    // red, red, blue, red, red — flood from x=0 should stop at the blue pixel
    const px = (x: number, r: number, g: number, b: number): void => {
      image.data[x * 4] = r;
      image.data[x * 4 + 1] = g;
      image.data[x * 4 + 2] = b;
      image.data[x * 4 + 3] = 255;
    };
    px(0, 255, 0, 0);
    px(1, 255, 0, 0);
    px(2, 0, 0, 255);
    px(3, 255, 0, 0);
    px(4, 255, 0, 0);

    const mask = floodFillMask(image, 0, 0, 0.1, true);
    expect(Array.from(mask.data)).toEqual([255, 255, 0, 0, 0]);
  });

  it("non-contiguous mode selects every matching pixel", () => {
    const image = createImage(5, 1);
    const px = (x: number, r: number): void => {
      image.data[x * 4] = r;
      image.data[x * 4 + 3] = 255;
    };
    [255, 255, 0, 255, 255].forEach((r, x) => px(x, r));
    const mask = floodFillMask(image, 0, 0, 0.1, false);
    expect(Array.from(mask.data)).toEqual([255, 255, 0, 255, 255]);
  });
});

describe("invertMask", () => {
  it("flips every value", () => {
    const mask = polygonMask(2, 1, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
    const inverted = invertMask(mask);
    for (let i = 0; i < mask.data.length; i++) {
      expect(inverted.data[i]).toBe(255 - mask.data[i]!);
    }
  });
});

describe("featherMask", () => {
  it("softens a hard edge without changing the fully-inside/outside extremes", () => {
    const mask = polygonMask(20, 20, [
      { x: 5, y: 5 },
      { x: 15, y: 5 },
      { x: 15, y: 15 },
      { x: 5, y: 15 },
    ]);
    const feathered = featherMask(mask, 3);
    // deep inside stays fully selected
    expect(feathered.data[10 * 20 + 10]).toBe(255);
    // far outside stays fully unselected
    expect(feathered.data[0]).toBe(0);
    // right at the boundary should now be a partial value
    const boundary = feathered.data[10 * 20 + 5]!;
    expect(boundary).toBeGreaterThan(0);
    expect(boundary).toBeLessThan(255);
  });

  it("radius 0 is a no-op copy", () => {
    const mask = polygonMask(4, 4, [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ]);
    const same = featherMask(mask, 0);
    expect(Array.from(same.data)).toEqual(Array.from(mask.data));
  });
});

describe("maskBounds", () => {
  it("computes the tight bounding rect", () => {
    const mask = polygonMask(20, 20, [
      { x: 3, y: 4 },
      { x: 9, y: 4 },
      { x: 9, y: 11 },
      { x: 3, y: 11 },
    ]);
    const bounds = maskBounds(mask);
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBe(3);
    expect(bounds!.y).toBe(4);
  });

  it("returns null for an empty mask", () => {
    const mask = polygonMask(4, 4, []);
    expect(maskBounds(mask)).toBeNull();
  });
});
