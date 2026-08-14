import { describe, expect, it } from "vitest";
import { spillFraction, suppressSpill } from "../src/spill.js";
import type { RasterImage } from "../src/types.js";

/**
 * Green-screen spill suppression.
 *
 * The claims worth pinning are the two that separate this from "desaturate a
 * bit": it must leave pixels that are *not* spilled alone, and it must not
 * darken the ones it treats. A suppression that dims edges produces a dark
 * fringe, which looks like a bad matte and gets "fixed" by feathering the
 * matte — making it worse.
 */

const image = (pixels: number[][]): RasterImage => {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b], i) => {
    data[i * 4] = r!;
    data[i * 4 + 1] = g!;
    data[i * 4 + 2] = b!;
    data[i * 4 + 3] = 255;
  });
  return { width: pixels.length, height: 1, data };
};

const px = (img: RasterImage, i: number): number[] => [
  img.data[i * 4]!,
  img.data[i * 4 + 1]!,
  img.data[i * 4 + 2]!,
];

const luma = (p: number[]): number =>
  0.299 * p[0]! + 0.587 * p[1]! + 0.114 * p[2]!;

describe("suppressSpill", () => {
  it("pulls an excess green channel back to what the others justify", () => {
    // 100/200/100: green is 100 above the average of red and blue.
    const out = suppressSpill(image([[100, 200, 100]]), "green", 1, false);
    expect(px(out, 0)[1]).toBe(100);
  });

  it("leaves a pixel alone when green is not in excess", () => {
    // Neutral grey and a red pixel: nothing to suppress, and touching them
    // would be a blanket desaturation rather than spill removal.
    const out = suppressSpill(
      image([
        [128, 128, 128],
        [200, 60, 60],
      ]),
      "green",
      1,
      false,
    );
    expect(px(out, 0)).toEqual([128, 128, 128]);
    expect(px(out, 1)).toEqual([200, 60, 60]);
  });

  it("suppresses proportionally at partial amounts", () => {
    // Half of a 100-code excess is 50.
    const out = suppressSpill(image([[100, 200, 100]]), "green", 0.5, false);
    expect(px(out, 0)[1]).toBe(150);
  });

  it("does nothing at all at amount zero", () => {
    const source = image([[100, 200, 100]]);
    const out = suppressSpill(source, "green", 0);
    expect([...out.data]).toEqual([...source.data]);
  });

  it("keeps the brightness it would otherwise remove", () => {
    // The dark-fringe failure. Pulling green down darkens the pixel; without
    // this the edge of a keyed subject gains a dark outline.
    const source = image([[100, 200, 100]]);
    const dimmed = suppressSpill(source, "green", 1, false);
    const preserved = suppressSpill(source, "green", 1, true);

    expect(luma(px(dimmed, 0))).toBeLessThan(luma(px(source, 0)) - 20);
    expect(luma(px(preserved, 0))).toBeCloseTo(luma(px(source, 0)), 0);
  });

  it("returns the brightness to the channels that were not suppressed", () => {
    // Putting it back into green would undo the suppression entirely.
    const out = suppressSpill(image([[100, 200, 100]]), "green", 1, true);
    const [r, g, b] = px(out, 0);
    expect(g!).toBeLessThan(200);
    expect(r!).toBeGreaterThan(100);
    expect(b!).toBeGreaterThan(100);
  });

  it("works on a blue screen too", () => {
    // Blue screens are still used for green wardrobe and some skin tones, so
    // the channel is a real choice rather than a constant.
    const out = suppressSpill(image([[100, 100, 220]]), "blue", 1, false);
    expect(px(out, 0)[2]).toBe(100);
    // And the green channel is untouched by a blue-screen pass.
    expect(px(out, 0)[1]).toBe(100);
  });

  it("does not mutate the image it was given", () => {
    const source = image([[100, 200, 100]]);
    const before = [...source.data];
    suppressSpill(source, "green", 1);
    expect([...source.data]).toEqual(before);
  });

  it("clamps an amount outside 0..1 rather than overshooting", () => {
    const full = suppressSpill(image([[100, 200, 100]]), "green", 1, false);
    const over = suppressSpill(image([[100, 200, 100]]), "green", 5, false);
    expect(px(over, 0)).toEqual(px(full, 0));
  });
});

describe("spillFraction", () => {
  it("is zero for a picture with no spill", () => {
    expect(
      spillFraction(
        image([
          [128, 128, 128],
          [200, 60, 60],
        ]),
      ),
    ).toBe(0);
  });

  it("counts only pixels meaningfully above the others", () => {
    // A couple of codes above average is noise, not spill; counting it would
    // report spill on a picture that has none.
    expect(spillFraction(image([[128, 132, 128]]))).toBe(0);
    expect(spillFraction(image([[100, 200, 100]]))).toBe(1);
  });

  it("falls after suppression, which is the point", () => {
    const source = image([
      [100, 200, 100],
      [90, 180, 95],
      [128, 128, 128],
    ]);
    expect(spillFraction(source)).toBeGreaterThan(0.5);
    expect(spillFraction(suppressSpill(source, "green", 1))).toBe(0);
  });
});
