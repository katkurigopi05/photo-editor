import { describe, expect, it } from "vitest";
import { createImage, createMask, pixelIndex } from "../src/types.js";
import {
  linearGradientMask,
  radialGradientMask,
  brushStrokeMask,
  luminanceRangeMask,
  colorRangeMask,
} from "../src/mask.js";
import { composeMasks, exposure } from "../src/adjust.js";

/**
 * Mask generators — the missing half of Lightroom's masking model.
 *
 * `adjust.ts` made every adjustment mask-aware, and `composeMasks` stacks
 * contributions, but nothing produced the contributions: there was no linear or
 * radial gradient, no brush, and no range mask. Without those, "any adjustment
 * can be local" was true only for a caller that hand-built a mask byte by byte.
 *
 * Coverage is a byte, not a boolean, everywhere here: partial coverage is what
 * makes a feathered gradient blend instead of cutting a hard edge, and what
 * lets range masks express "mostly this colour".
 */

const at = (
  mask: { data: Uint8ClampedArray; width: number },
  x: number,
  y: number,
): number => mask.data[y * mask.width + x]!;

/** A flat image of one colour, fully opaque. */
function solid(width: number, height: number, r: number, g: number, b: number) {
  const image = createImage(width, height);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = r;
    image.data[i + 1] = g;
    image.data[i + 2] = b;
    image.data[i + 3] = 255;
  }
  return image;
}

describe("linearGradientMask", () => {
  it("runs from uncovered at the start line to fully covered at the end line", () => {
    const mask = linearGradientMask(16, 4, { x: 0, y: 0 }, { x: 15, y: 0 });
    expect(at(mask, 0, 0)).toBe(0);
    expect(at(mask, 15, 0)).toBe(255);
    expect(at(mask, 8, 0)).toBeGreaterThan(100);
    expect(at(mask, 8, 0)).toBeLessThan(160);
  });

  it("is constant along the gradient's own axis", () => {
    // A vertical gradient must not vary left to right; that perpendicular
    // invariance is the whole point of a linear mask.
    const mask = linearGradientMask(8, 8, { x: 0, y: 0 }, { x: 0, y: 7 });
    for (let y = 0; y < 8; y++) {
      const first = at(mask, 0, y);
      for (let x = 1; x < 8; x++) expect(at(mask, x, y)).toBe(first);
    }
  });

  it("clamps beyond both ends rather than extrapolating", () => {
    const mask = linearGradientMask(16, 1, { x: 4, y: 0 }, { x: 8, y: 0 });
    expect(at(mask, 0, 0)).toBe(0);
    expect(at(mask, 3, 0)).toBe(0);
    expect(at(mask, 9, 0)).toBe(255);
    expect(at(mask, 15, 0)).toBe(255);
  });

  it("works on a diagonal", () => {
    const mask = linearGradientMask(8, 8, { x: 0, y: 0 }, { x: 7, y: 7 });
    expect(at(mask, 0, 0)).toBe(0);
    expect(at(mask, 7, 7)).toBe(255);
    expect(at(mask, 7, 0)).toBe(at(mask, 0, 7));
  });

  it("degenerates safely when both points coincide", () => {
    const mask = linearGradientMask(4, 4, { x: 2, y: 2 }, { x: 2, y: 2 });
    for (const value of mask.data) expect(Number.isFinite(value)).toBe(true);
  });
});

describe("radialGradientMask", () => {
  it("covers the centre and falls away past the radius", () => {
    const mask = radialGradientMask(21, 21, { x: 10, y: 10 }, 8, 0.5);
    expect(at(mask, 10, 10)).toBe(255);
    expect(at(mask, 20, 10)).toBe(0);
  });

  it("feathers inward from the edge by the feather fraction", () => {
    const soft = radialGradientMask(21, 21, { x: 10, y: 10 }, 10, 1);
    const hard = radialGradientMask(21, 21, { x: 10, y: 10 }, 10, 0);
    // Half way out, a fully feathered mask has already begun to fade while a
    // hard-edged one is still solid.
    expect(at(soft, 15, 10)).toBeLessThan(255);
    expect(at(hard, 15, 10)).toBe(255);
  });

  it("is radially symmetric", () => {
    const mask = radialGradientMask(21, 21, { x: 10, y: 10 }, 8, 0.5);
    expect(at(mask, 14, 10)).toBe(at(mask, 6, 10));
    expect(at(mask, 10, 14)).toBe(at(mask, 10, 6));
  });

  it("can be inverted to select the surround instead", () => {
    const inside = radialGradientMask(21, 21, { x: 10, y: 10 }, 8, 0, false);
    const outside = radialGradientMask(21, 21, { x: 10, y: 10 }, 8, 0, true);
    expect(at(inside, 10, 10)).toBe(255);
    expect(at(outside, 10, 10)).toBe(0);
    expect(at(outside, 20, 10)).toBe(255);
  });

  it("supports an elliptical radius", () => {
    const mask = radialGradientMask(
      41,
      21,
      { x: 20, y: 10 },
      { x: 18, y: 6 },
      0,
    );
    expect(at(mask, 34, 10)).toBe(255); // inside the wide axis
    expect(at(mask, 20, 18)).toBe(0); // outside the short axis
  });
});

describe("brushStrokeMask", () => {
  it("covers the stroke and nothing far from it", () => {
    const mask = brushStrokeMask(
      32,
      32,
      [
        { x: 4, y: 16 },
        { x: 28, y: 16 },
      ],
      3,
      0,
    );
    expect(at(mask, 16, 16)).toBe(255);
    expect(at(mask, 16, 30)).toBe(0);
  });

  it("joins consecutive points instead of leaving dotted gaps", () => {
    // Two points ten pixels apart with a two-pixel brush: sampling only the
    // points would leave the middle empty, which is what a naive stamp does.
    const mask = brushStrokeMask(
      24,
      8,
      [
        { x: 4, y: 4 },
        { x: 14, y: 4 },
      ],
      2,
      0,
    );
    for (let x = 4; x <= 14; x++) expect(at(mask, x, 4)).toBe(255);
  });

  it("softens the edge with feather without hollowing the core", () => {
    const mask = brushStrokeMask(32, 32, [{ x: 16, y: 16 }], 8, 1);
    expect(at(mask, 16, 16)).toBe(255);
    const edge = at(mask, 22, 16);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
  });

  it("returns an empty mask for an empty stroke", () => {
    const mask = brushStrokeMask(8, 8, [], 4, 0);
    expect([...mask.data].every((v) => v === 0)).toBe(true);
  });
});

describe("luminanceRangeMask", () => {
  it("selects only pixels inside the luminance window", () => {
    const image = createImage(3, 1);
    const set = (x: number, v: number): void => {
      const p = pixelIndex(x, 0, 3);
      image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
      image.data[p + 3] = 255;
    };
    set(0, 10);
    set(1, 128);
    set(2, 245);

    const mask = luminanceRangeMask(image, 0.3, 0.7, 0);
    expect(at(mask, 0, 0)).toBe(0);
    expect(at(mask, 1, 0)).toBe(255);
    expect(at(mask, 2, 0)).toBe(0);
  });

  it("feathers the window edges rather than cutting them", () => {
    const image = createImage(1, 1);
    image.data.set([170, 170, 170, 255]); // ~0.667 luminance
    const hard = luminanceRangeMask(image, 0.3, 0.6, 0);
    const soft = luminanceRangeMask(image, 0.3, 0.6, 0.3);
    expect(hard.data[0]).toBe(0);
    expect(soft.data[0]).toBeGreaterThan(0);
    expect(soft.data[0]).toBeLessThan(255);
  });
});

describe("colorRangeMask", () => {
  it("selects pixels near the sampled colour", () => {
    const image = createImage(3, 1);
    const set = (x: number, rgb: [number, number, number]): void => {
      const p = pixelIndex(x, 0, 3);
      image.data[p] = rgb[0];
      image.data[p + 1] = rgb[1];
      image.data[p + 2] = rgb[2];
      image.data[p + 3] = 255;
    };
    set(0, [200, 30, 30]); // target
    set(1, [190, 40, 35]); // near
    set(2, [30, 40, 200]); // far

    const mask = colorRangeMask(image, { r: 200, g: 30, b: 30 }, 0.15, 0);
    expect(at(mask, 0, 0)).toBe(255);
    expect(at(mask, 1, 0)).toBe(255);
    expect(at(mask, 2, 0)).toBe(0);
  });

  it("widens with tolerance", () => {
    const image = createImage(1, 1);
    image.data.set([120, 60, 60, 255]);
    const tight = colorRangeMask(image, { r: 200, g: 30, b: 30 }, 0.05, 0);
    const loose = colorRangeMask(image, { r: 200, g: 30, b: 30 }, 0.6, 0);
    expect(tight.data[0]).toBe(0);
    expect(loose.data[0]).toBe(255);
  });
});

describe("masks and adjustments together", () => {
  it("confines an adjustment to the masked region", () => {
    // The property the whole model rests on: the same adjustment, applied
    // through a mask, changes the covered pixels and leaves the rest alone.
    const image = solid(8, 1, 100, 100, 100);
    const mask = createMask(8, 1);
    for (let x = 0; x < 4; x++) mask.data[x] = 255;

    const out = exposure(image, 1, mask);
    expect(out.data[pixelIndex(0, 0, 8)]).toBe(200);
    expect(out.data[pixelIndex(7, 0, 8)]).toBe(100);
  });

  it("blends proportionally where coverage is partial", () => {
    const image = solid(2, 1, 100, 100, 100);
    const mask = createMask(2, 1);
    mask.data[0] = 128; // roughly half covered
    mask.data[1] = 0;

    const out = exposure(image, 1, mask);
    expect(out.data[0]).toBeGreaterThan(140);
    expect(out.data[0]).toBeLessThan(160);
    expect(out.data[4]).toBe(100);
  });

  it("stacks generated masks through composeMasks", () => {
    const circle = radialGradientMask(32, 32, { x: 10, y: 16 }, 8, 0);
    const other = radialGradientMask(32, 32, { x: 22, y: 16 }, 8, 0);

    const union = composeMasks(32, 32, [
      { mask: circle, mode: "add" },
      { mask: other, mode: "add" },
    ]);
    expect(at(union, 10, 16)).toBe(255);
    expect(at(union, 22, 16)).toBe(255);

    const intersection = composeMasks(32, 32, [
      { mask: circle, mode: "add" },
      { mask: other, mode: "intersect" },
    ]);
    expect(at(intersection, 10, 16)).toBe(0);
    expect(at(intersection, 16, 16)).toBe(255); // the shared overlap

    const difference = composeMasks(32, 32, [
      { mask: circle, mode: "add" },
      { mask: other, mode: "subtract" },
    ]);
    expect(at(difference, 10, 16)).toBe(255);
    expect(at(difference, 16, 16)).toBe(0);
  });
});
