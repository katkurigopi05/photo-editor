import { describe, expect, test } from "vitest";
import type { Mask } from "@director/raster-tools";
import { biasSubjectMask, bokehGain } from "../src/portrait-blur.js";

/** A mask whose left half is subject (255) and right half is background (0). */
function halfMask(width = 8, height = 4): Mask {
  const data = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = x < width / 2 ? 255 : 0;
    }
  }
  return { width, height, data };
}

const subjectPixels = (m: Mask): number =>
  m.data.reduce((n, v) => n + (v > 127 ? 1 : 0), 0);

describe("biasSubjectMask", () => {
  test("returns the mask unchanged at scale 1", () => {
    const mask = halfMask();
    const out = biasSubjectMask(mask, 1);
    expect(Array.from(out.data)).toEqual(Array.from(mask.data));
  });

  test("grows the subject when scale is above 1", () => {
    const mask = halfMask();
    const grown = biasSubjectMask(mask, 1.5);
    expect(subjectPixels(grown)).toBeGreaterThan(subjectPixels(mask));
  });

  test("shrinks the subject when scale is below 1", () => {
    const mask = halfMask();
    const shrunk = biasSubjectMask(mask, 0.5);
    expect(subjectPixels(shrunk)).toBeLessThan(subjectPixels(mask));
  });

  test("is monotonic in scale", () => {
    // A bigger subjectScale must never select fewer pixels than a smaller one:
    // the slider has to feel like one continuous control.
    const mask = halfMask(16, 8);
    const counts = [0.6, 0.8, 1, 1.2, 1.4].map((s) =>
      subjectPixels(biasSubjectMask(mask, s)),
    );
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]!, `scale step ${i}`).toBeGreaterThanOrEqual(
        counts[i - 1]!,
      );
    }
  });

  test("keeps mask dimensions and never mutates the input", () => {
    const mask = halfMask();
    const before = Array.from(mask.data);
    const out = biasSubjectMask(mask, 1.4);
    expect(out.width).toBe(mask.width);
    expect(out.height).toBe(mask.height);
    expect(Array.from(mask.data)).toEqual(before);
  });

  test("leaves an all-subject mask fully selected", () => {
    const solid: Mask = {
      width: 4,
      height: 2,
      data: new Uint8ClampedArray(8).fill(255),
    };
    expect(subjectPixels(biasSubjectMask(solid, 1.4))).toBe(8);
  });
});

describe("bokehGain", () => {
  test("is 1 at zero strength, so the background is only blurred", () => {
    expect(bokehGain(0, 255)).toBe(1);
    expect(bokehGain(0, 0)).toBe(1);
  });

  test("lifts bright pixels more than dark ones", () => {
    // Bokeh is highlight bloom: a specular point blooms, a shadow does not.
    const dark = bokehGain(1, 20);
    const bright = bokehGain(1, 250);
    expect(bright).toBeGreaterThan(dark);
    expect(dark).toBeCloseTo(1, 2);
  });

  test("scales with strength", () => {
    expect(bokehGain(1, 250)).toBeGreaterThan(bokehGain(0.5, 250));
  });

  test("never darkens and stays bounded", () => {
    for (const strength of [0, 0.25, 0.5, 0.75, 1]) {
      for (const luma of [0, 64, 128, 192, 255]) {
        const g = bokehGain(strength, luma);
        expect(g, `s=${strength} l=${luma}`).toBeGreaterThanOrEqual(1);
        expect(g, `s=${strength} l=${luma}`).toBeLessThanOrEqual(2.5);
      }
    }
  });
});
