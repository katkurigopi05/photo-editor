import { describe, expect, it } from "vitest";
import {
  createImage,
  createMask,
  type Mask,
  type RasterImage,
} from "@director/raster-tools";
import {
  guidedFilterMatte,
  morphologyMask,
  refineMatteEdges,
  trimapFromMask,
} from "../src/matting.js";

function makeSyntheticImage(w = 16, h = 16): RasterImage {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      // High contrast step in the middle: x >= w / 2 is bright white, left is dark black
      const val = x >= Math.floor(w / 2) ? 240 : 20;
      img.data[idx] = val;
      img.data[idx + 1] = val;
      img.data[idx + 2] = val;
      img.data[idx + 3] = 255;
    }
  }
  return img;
}

function makeSyntheticMask(w = 16, h = 16): Mask {
  const mask = createMask(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Blurry/coarse step edge slightly misaligned (e.g. at w/2 - 1)
      const val = x >= Math.floor(w / 2) - 1 ? 200 : 30;
      mask.data[y * w + x] = val;
    }
  }
  return mask;
}

describe("guidedFilterMatte", () => {
  it("throws when guide and matte dimensions mismatch", () => {
    const guide = createImage(16, 16);
    const matte = createMask(16, 18);
    expect(() => guidedFilterMatte(guide, matte)).toThrow(
      "Guide image dimensions (16x16) must match matte dimensions (16x18)",
    );
  });

  it("returns identical copy when radiusPx is 0", () => {
    const guide = makeSyntheticImage(8, 8);
    const matte = makeSyntheticMask(8, 8);
    const result = guidedFilterMatte(guide, matte, { radiusPx: 0 });
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
    expect(result.data).toEqual(matte.data);
  });

  it("preserves bounds [0, 255] and aligns matte to high-contrast guidance edges", () => {
    const guide = makeSyntheticImage(20, 20);
    const matte = makeSyntheticMask(20, 20);
    const refined = guidedFilterMatte(guide, matte, { radiusPx: 2, eps: 1e-3 });

    expect(refined.width).toBe(20);
    expect(refined.height).toBe(20);

    for (let i = 0; i < refined.data.length; i++) {
      const val = refined.data[i]!;
      expect(Number.isFinite(val)).toBe(true);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(255);
    }

    // Leftmost columns (deep background in guide) should be dark
    expect(refined.data[0]).toBeLessThan(60);
    // Rightmost columns (foreground in guide) should be bright
    expect(refined.data[19]).toBeGreaterThan(180);
  });
});

describe("morphologyMask", () => {
  it("returns identical copy when radiusPx is 0", () => {
    const mask = createMask(10, 10);
    mask.data[55] = 255;
    const dilated = morphologyMask(mask, 0, "dilate");
    expect(dilated.data).toEqual(mask.data);
  });

  it("dilates a single pixel mask by radius", () => {
    const mask = createMask(10, 10);
    const center = 5 * 10 + 5;
    mask.data[center] = 255;

    const dilated = morphologyMask(mask, 1, "dilate");
    // Neighbors in 3x3 window should become 255
    expect(dilated.data[center]).toBe(255);
    expect(dilated.data[center + 1]).toBe(255);
    expect(dilated.data[center - 1]).toBe(255);
    expect(dilated.data[center + 10]).toBe(255);
    expect(dilated.data[center - 10]).toBe(255);
    // Far corner should still be 0
    expect(dilated.data[0]).toBe(0);
  });

  it("erodes a block mask inward", () => {
    const mask = createMask(10, 10);
    // Fill 6x6 block in center
    for (let y = 2; y <= 7; y++) {
      for (let x = 2; x <= 7; x++) {
        mask.data[y * 10 + x] = 255;
      }
    }

    const eroded = morphologyMask(mask, 1, "erode");
    // Boundary of block should become 0
    expect(eroded.data[2 * 10 + 2]).toBe(0);
    expect(eroded.data[2 * 10 + 3]).toBe(0);
    // Center of block should stay 255
    expect(eroded.data[4 * 10 + 4]).toBe(255);
  });
});

describe("refineMatteEdges", () => {
  it("applies guided filtering, morphology, and gamma adjustment", () => {
    const guide = makeSyntheticImage(16, 16);
    const mask = makeSyntheticMask(16, 16);

    const refined = refineMatteEdges(guide, mask, {
      radiusPx: 2,
      morphologyRadiusPx: -1, // choke by 1px
      gamma: 1.2,
    });

    expect(refined.width).toBe(16);
    expect(refined.height).toBe(16);
    expect(refined.data.length).toBe(256);
    expect(refined.data.every((v) => v >= 0 && v <= 255)).toBe(true);
  });
});

describe("trimapFromMask", () => {
  it("partitions mask into foreground (255), background (0), and unknown (128)", () => {
    const mask = createMask(10, 10);
    mask.data[0] = 5; // bg
    mask.data[1] = 120; // unknown
    mask.data[2] = 250; // fg

    const { trimap, foregroundCount, backgroundCount, unknownCount } =
      trimapFromMask(mask, 240, 15);

    expect(trimap.data[0]).toBe(0);
    expect(trimap.data[1]).toBe(128);
    expect(trimap.data[2]).toBe(255);

    expect(foregroundCount).toBe(1);
    expect(backgroundCount).toBe(98);
    expect(unknownCount).toBe(1);
  });
});
