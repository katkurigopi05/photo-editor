import { describe, expect, it } from "vitest";
import { createImage, createMask } from "@director/raster-tools";
import type { ClipMask } from "@director/project-schema";
import { rasterizeClipMask, blendThroughMask } from "../src/mask-raster.js";

/**
 * Normalized mask geometry meeting a specific frame.
 *
 * The property that matters is resolution independence: the same stored mask
 * has to cover the same *fraction* of the frame whatever size it is rasterized
 * at, because the preview and the export are different sizes and a mask that
 * drifted between them would put a local adjustment in the wrong place in the
 * file the user keeps.
 */

function grey(width: number, height: number, value = 128) {
  const image = createImage(width, height);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  return image;
}

const at = (mask: { data: Uint8ClampedArray; width: number }, x: number, y: number) =>
  mask.data[y * mask.width + x]!;

const radial = (overrides: Record<string, unknown> = {}): ClipMask => ({
  id: "mask-1",
  contributions: [
    {
      id: "c1",
      kind: "radial",
      mode: "add",
      centre: { x: 0.5, y: 0.5 },
      radius: { x: 0.25, y: 0.25 },
      feather: 0,
      invert: false,
      ...overrides,
    },
  ],
});

describe("rasterizeClipMask", () => {
  it("places a radial mask at the same fraction of any frame size", () => {
    const small = rasterizeClipMask(radial(), grey(40, 40));
    const large = rasterizeClipMask(radial(), grey(400, 400));
    // Centre covered, the far corner not, at both sizes.
    expect(at(small, 20, 20)).toBe(255);
    expect(at(large, 200, 200)).toBe(255);
    expect(at(small, 39, 39)).toBe(0);
    expect(at(large, 399, 399)).toBe(0);
    // And the covered fraction matches to within a pixel of quantization.
    const coveredFraction = (mask: { data: Uint8ClampedArray }): number =>
      [...mask.data].reduce((total, v) => total + v / 255, 0) /
      mask.data.length;
    expect(coveredFraction(large)).toBeCloseTo(coveredFraction(small), 1);
  });

  it("maps a linear gradient across the frame", () => {
    const mask: ClipMask = {
      id: "mask-1",
      contributions: [
        {
          id: "c1",
          kind: "linear",
          mode: "add",
          from: { x: 0, y: 0 },
          to: { x: 1, y: 0 },
        },
      ],
    };
    const raster = rasterizeClipMask(mask, grey(100, 10));
    expect(at(raster, 0, 0)).toBe(0);
    expect(at(raster, 99, 0)).toBe(255);
  });

  it("reads the frame's own pixels for a luminance range", () => {
    const image = createImage(2, 1);
    image.data.set([20, 20, 20, 255, 230, 230, 230, 255]);
    const mask: ClipMask = {
      id: "mask-1",
      contributions: [
        {
          id: "c1",
          kind: "luminance_range",
          mode: "add",
          min: 0.6,
          max: 1,
          feather: 0,
        },
      ],
    };
    const raster = rasterizeClipMask(mask, image);
    expect(at(raster, 0, 0)).toBe(0);
    expect(at(raster, 1, 0)).toBe(255);
  });

  it("composes contributions in order", () => {
    const mask: ClipMask = {
      id: "mask-1",
      contributions: [
        ...radial().contributions,
        {
          id: "c2",
          kind: "radial",
          mode: "subtract",
          centre: { x: 0.5, y: 0.5 },
          radius: { x: 0.1, y: 0.1 },
          feather: 0,
          invert: false,
        },
      ],
    };
    const raster = rasterizeClipMask(mask, grey(100, 100));
    expect(at(raster, 50, 50)).toBe(0); // punched out by the subtract
    expect(at(raster, 50, 35)).toBe(255); // still inside the first circle
  });

  it("scales a brush radius against the frame's smaller side", () => {
    // A stroke keeps its thickness relative to the picture, not to whichever
    // axis happens to be longer.
    const mask: ClipMask = {
      id: "mask-1",
      contributions: [
        {
          id: "c1",
          kind: "brush",
          mode: "add",
          points: [
            { x: 0.25, y: 0.5 },
            { x: 0.75, y: 0.5 },
          ],
          radius: 0.1,
          feather: 0,
        },
      ],
    };
    const wide = rasterizeClipMask(mask, grey(200, 100));
    expect(at(wide, 100, 50)).toBe(255);
    expect(at(wide, 100, 50 + 9)).toBe(255); // within 10% of 100px
    expect(at(wide, 100, 50 + 20)).toBe(0);
  });
});

describe("blendThroughMask", () => {
  const original = grey(4, 1, 100);
  const adjusted = grey(4, 1, 200);

  it("takes the adjusted pixels where covered and the original where not", () => {
    const mask = createMask(4, 1);
    mask.data[0] = 255;
    mask.data[1] = 0;
    const out = blendThroughMask(original, adjusted, mask);
    expect(out.data[0]).toBe(200);
    expect(out.data[4]).toBe(100);
  });

  it("blends proportionally at partial coverage", () => {
    const mask = createMask(4, 1);
    mask.data[0] = 128;
    const out = blendThroughMask(original, adjusted, mask);
    expect(out.data[0]).toBeGreaterThan(140);
    expect(out.data[0]).toBeLessThan(160);
  });

  it("carries alpha through the blend", () => {
    const transparent = grey(4, 1, 200);
    for (let i = 3; i < transparent.data.length; i += 4) transparent.data[i] = 0;
    const mask = createMask(4, 1);
    mask.data[0] = 255;
    const out = blendThroughMask(original, transparent, mask);
    expect(out.data[3]).toBe(0);
    expect(out.data[7]).toBe(255);
  });

  it("does not mutate either input", () => {
    const mask = createMask(4, 1);
    mask.data.fill(255);
    const before = Array.from(original.data);
    blendThroughMask(original, adjusted, mask);
    expect(Array.from(original.data)).toEqual(before);
  });
});
