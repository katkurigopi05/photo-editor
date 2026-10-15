import { describe, expect, it } from "vitest";
import { createImage, createMask, type Mask, type RasterImage } from "@director/raster-tools";
import {
  refineEdgeMatte,
  chokeMatte,
  expandMatte,
  generateTrimap,
  computeMattingQualityMetrics,
} from "../src/edge-matting.js";

function makeTestImage(w = 32, h = 32): RasterImage {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const isForeground = x >= 10 && x <= 22 && y >= 10 && y <= 22;
      const color = isForeground ? 230 : 30;
      img.data[idx] = color;
      img.data[idx + 1] = color;
      img.data[idx + 2] = color;
      img.data[idx + 3] = 255;
    }
  }
  return img;
}

function makeTestMask(w = 32, h = 32): Mask {
  const mask = createMask(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Slightly larger/rough mask (9..23)
      const isForeground = x >= 9 && x <= 23 && y >= 9 && y <= 23;
      mask.data[y * w + x] = isForeground ? 255 : 0;
    }
  }
  return mask;
}

describe("Edge Matting Pipeline", () => {
  it("refines matte edges using guided filtering and boundary alignment", () => {
    const image = makeTestImage(32, 32);
    const mask = makeTestMask(32, 32);

    const refined = refineEdgeMatte(image, mask, {
      radiusPx: 2,
      eps: 1e-3,
      gamma: 1.1,
    });

    expect(refined.width).toBe(32);
    expect(refined.height).toBe(32);
    expect(refined.data.length).toBe(32 * 32);

    // Far background remains dark
    expect(refined.data[0]).toBe(0);
    // Deep foreground remains bright
    expect(refined.data[16 * 32 + 16]).toBeGreaterThan(200);
  });

  it("chokes the matte boundary inward to eliminate fringe halos", () => {
    const mask = makeTestMask(32, 32);
    const choked = chokeMatte(mask, 1);

    expect(choked.width).toBe(32);
    expect(choked.height).toBe(32);

    // Boundary pixel that was foreground at (9, 9) should become 0 after 1px choke
    expect(mask.data[9 * 32 + 9]).toBe(255);
    expect(choked.data[9 * 32 + 9]).toBe(0);
    // Interior pixel remains 255
    expect(choked.data[16 * 32 + 16]).toBe(255);
  });

  it("expands the matte boundary outward", () => {
    const mask = makeTestMask(32, 32);
    const expanded = expandMatte(mask, 1);

    expect(expanded.width).toBe(32);
    expect(expanded.height).toBe(32);

    // Pixel at (8, 8) was 0, should become 255 after 1px expand
    expect(mask.data[8 * 32 + 8]).toBe(0);
    expect(expanded.data[8 * 32 + 8]).toBe(255);
  });

  it("generates a valid 3-state Trimap", () => {
    const mask = createMask(16, 16);
    mask.data[0] = 0;    // bg
    mask.data[1] = 100;  // unknown
    mask.data[2] = 255;  // fg

    const { trimap, foregroundCount, backgroundCount, unknownCount } =
      generateTrimap(mask, 200, 50);

    expect(trimap.data[0]).toBe(0);
    expect(trimap.data[1]).toBe(128);
    expect(trimap.data[2]).toBe(255);

    expect(foregroundCount).toBe(1);
    expect(backgroundCount).toBe(254);
    expect(unknownCount).toBe(1);
  });

  it("computes meaningful edge quality and coverage metrics", () => {
    const image = makeTestImage(32, 32);
    const mask = makeTestMask(32, 32);

    const metrics = computeMattingQualityMetrics(image, mask);
    expect(metrics.coverageFraction).toBeGreaterThan(0.1);
    expect(metrics.coverageFraction).toBeLessThan(0.4);
    expect(metrics.foregroundPixels).toBeGreaterThan(100);
    expect(metrics.backgroundPixels).toBeGreaterThan(500);
    expect(typeof metrics.edgeGradientMean).toBe("number");
  });
});
