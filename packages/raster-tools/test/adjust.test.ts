import { describe, expect, it } from "vitest";
import { createImage, createMask, type RasterImage } from "../src/types.js";
import {
  blacks,
  colorMixer,
  composeMasks,
  contrast,
  exposure,
  highlights,
  hslToRgb,
  luma,
  rgbToHsl,
  saturation,
  shadows,
  temperature,
  tint,
  vibrance,
  whites,
} from "../src/adjust.js";

function solid(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
): RasterImage {
  const image = createImage(width, height);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = r;
    image.data[i + 1] = g;
    image.data[i + 2] = b;
    image.data[i + 3] = 255;
  }
  return image;
}

/** Read pixel `n` as [r, g, b, a]. */
function px(image: RasterImage, n: number): number[] {
  const i = n * 4;
  return [
    image.data[i]!,
    image.data[i + 1]!,
    image.data[i + 2]!,
    image.data[i + 3]!,
  ];
}

describe("purity and alpha", () => {
  it("never mutates the input", () => {
    const image = solid(2, 2, 100, 110, 120);
    const before = Uint8ClampedArray.from(image.data);
    exposure(image, 1);
    contrast(image, 50);
    saturation(image, -100);
    expect(Array.from(image.data)).toEqual(Array.from(before));
  });

  it("carries alpha through untouched", () => {
    const image = solid(1, 1, 10, 20, 30);
    image.data[3] = 77;
    expect(px(exposure(image, 2), 0)[3]).toBe(77);
    expect(px(saturation(image, 100), 0)[3]).toBe(77);
  });
});

describe("identity at zero", () => {
  const image = solid(2, 1, 90, 140, 200);
  const cases: [string, RasterImage][] = [
    ["exposure", exposure(image, 0)],
    ["contrast", contrast(image, 0)],
    ["highlights", highlights(image, 0)],
    ["shadows", shadows(image, 0)],
    ["whites", whites(image, 0)],
    ["blacks", blacks(image, 0)],
    ["temperature", temperature(image, 0)],
    ["tint", tint(image, 0)],
    ["saturation", saturation(image, 0)],
    ["vibrance", vibrance(image, 0)],
  ];

  it.each(cases)("%s at 0 is a no-op", (_name, result) => {
    expect(Array.from(result.data)).toEqual(Array.from(image.data));
  });
});

describe("exposure", () => {
  it("+1 stop doubles, -1 stop halves", () => {
    const image = solid(1, 1, 50, 60, 70);
    expect(px(exposure(image, 1), 0).slice(0, 3)).toEqual([100, 120, 140]);
    expect(px(exposure(image, -1), 0).slice(0, 3)).toEqual([25, 30, 35]);
  });

  it("clamps rather than wrapping", () => {
    const image = solid(1, 1, 200, 200, 200);
    expect(px(exposure(image, 3), 0).slice(0, 3)).toEqual([255, 255, 255]);
  });
});

describe("contrast", () => {
  it("pushes away from mid-grey, and mid-grey itself barely moves", () => {
    const dark = solid(1, 1, 60, 60, 60);
    const bright = solid(1, 1, 200, 200, 200);
    const grey = solid(1, 1, 128, 128, 128);
    expect(px(contrast(dark, 50), 0)[0]).toBeLessThan(60);
    expect(px(contrast(bright, 50), 0)[0]).toBeGreaterThan(200);
    expect(px(contrast(grey, 50), 0)[0]).toBeCloseTo(128, -1);
  });
});

describe("tonal regions target their own end", () => {
  const dark = solid(1, 1, 30, 30, 30);
  const bright = solid(1, 1, 230, 230, 230);

  it("highlights move brights far more than darks", () => {
    const darkDelta = Math.abs(px(highlights(dark, -80), 0)[0]! - 30);
    const brightDelta = Math.abs(px(highlights(bright, -80), 0)[0]! - 230);
    expect(brightDelta).toBeGreaterThan(darkDelta * 5);
  });

  it("shadows move darks far more than brights", () => {
    const darkDelta = Math.abs(px(shadows(dark, 80), 0)[0]! - 30);
    const brightDelta = Math.abs(px(shadows(bright, 80), 0)[0]! - 230);
    expect(darkDelta).toBeGreaterThan(brightDelta * 5);
  });

  it("whites/blacks reach further than highlights/shadows", () => {
    const mid = solid(1, 1, 128, 128, 128);
    const viaWhites = Math.abs(px(whites(mid, 50), 0)[0]! - 128);
    const viaHighlights = Math.abs(px(highlights(mid, 50), 0)[0]! - 128);
    expect(viaWhites).toBeGreaterThan(viaHighlights);
  });
});

describe("colour", () => {
  it("temperature warms red and cools blue in opposite directions", () => {
    const image = solid(1, 1, 128, 128, 128);
    const warm = px(temperature(image, 100), 0);
    expect(warm[0]).toBeGreaterThan(128);
    expect(warm[2]).toBeLessThan(128);
    expect(warm[1]).toBe(128); // green is the axis, untouched
  });

  it("tint moves green against magenta", () => {
    const image = solid(1, 1, 128, 128, 128);
    const magenta = px(tint(image, 100), 0);
    expect(magenta[1]).toBeLessThan(128);
    expect(magenta[0]).toBeGreaterThan(128);
  });

  it("saturation at -100 is greyscale, preserving luma", () => {
    const image = solid(1, 1, 200, 100, 50);
    const grey = px(saturation(image, -100), 0);
    expect(grey[0]).toBe(grey[1]);
    expect(grey[1]).toBe(grey[2]);
    expect(grey[0]).toBeCloseTo(luma(200, 100, 50), 0);
  });

  it("vibrance moves muted colours more than vivid ones", () => {
    const muted = solid(1, 1, 130, 120, 110);
    const vivid = solid(1, 1, 255, 10, 10);
    const mutedDelta = Math.abs(px(vibrance(muted, 100), 0)[0]! - 130);
    const vividDelta = Math.abs(px(vibrance(vivid, 100), 0)[1]! - 10);
    expect(mutedDelta).toBeGreaterThan(vividDelta);
  });
});

describe("HSL round trip", () => {
  it("rgb -> hsl -> rgb returns the original", () => {
    for (const [r, g, b] of [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [123, 200, 45],
      [10, 10, 10],
    ]) {
      const [h, s, l] = rgbToHsl(r!, g!, b!);
      const [r2, g2, b2] = hslToRgb(h, s, l);
      expect(r2).toBeCloseTo(r!, 0);
      expect(g2).toBeCloseTo(g!, 0);
      expect(b2).toBeCloseTo(b!, 0);
    }
  });
});

describe("colorMixer", () => {
  it("affects the targeted band and leaves a distant band alone", () => {
    const red = solid(1, 1, 220, 30, 30);
    const blue = solid(1, 1, 30, 30, 220);
    const bands = { red: { saturation: -100 } } as const;
    const redOut = px(colorMixer(red, bands), 0);
    const blueOut = px(colorMixer(blue, bands), 0);
    // red desaturates toward grey
    expect(Math.abs(redOut[0]! - redOut[1]!)).toBeLessThan(220 - 30);
    // blue is more than 60 degrees away, so it is untouched
    expect(blueOut.slice(0, 3)).toEqual([30, 30, 220]);
  });

  it("leaves near-grey pixels alone (no hue to shift)", () => {
    const grey = solid(1, 1, 128, 128, 129);
    const out = px(colorMixer(grey, { red: { hue: 100, saturation: 100 } }), 0);
    expect(out.slice(0, 3)).toEqual([128, 128, 129]);
  });

  it("with no bands is a no-op", () => {
    const image = solid(2, 2, 200, 100, 50);
    expect(Array.from(colorMixer(image, {}).data)).toEqual(
      Array.from(image.data),
    );
  });

  it("blends overlapping bands instead of banding hard", () => {
    // A hue between orange (30) and yellow (60) should be pulled by both.
    const between = solid(1, 1, 230, 180, 40);
    const onlyOrange = px(
      colorMixer(between, { orange: { luminance: -50 } }),
      0,
    );
    const both = px(
      colorMixer(between, {
        orange: { luminance: -50 },
        yellow: { luminance: -50 },
      }),
      0,
    );
    expect(both[0]).toBeLessThan(onlyOrange[0]!);
  });
});

describe("mask awareness", () => {
  it("applies fully where covered and not at all where uncovered", () => {
    const image = solid(2, 1, 100, 100, 100);
    const mask = createMask(2, 1);
    mask.data[0] = 255; // first pixel only
    const out = exposure(image, 1, mask);
    expect(px(out, 0).slice(0, 3)).toEqual([200, 200, 200]);
    expect(px(out, 1).slice(0, 3)).toEqual([100, 100, 100]);
  });

  it("blends proportionally at partial (feathered) coverage", () => {
    const image = solid(1, 1, 100, 100, 100);
    const mask = createMask(1, 1);
    mask.data[0] = 128; // ~50%
    // full effect would be 200; half coverage lands about midway
    expect(px(exposure(image, 1, mask), 0)[0]).toBeCloseTo(150, -1);
  });

  it("an all-zero mask makes every adjustment a no-op", () => {
    const image = solid(2, 2, 90, 140, 200);
    const empty = createMask(2, 2);
    for (const out of [
      exposure(image, 2, empty),
      contrast(image, 80, empty),
      saturation(image, -100, empty),
      colorMixer(image, { blue: { saturation: -100 } }, empty),
    ]) {
      expect(Array.from(out.data)).toEqual(Array.from(image.data));
    }
  });

  it("rejects a mask whose size does not match the image", () => {
    const image = solid(2, 2, 10, 10, 10);
    expect(() => exposure(image, 1, createMask(3, 3))).toThrow(
      /does not match/,
    );
  });
});

describe("composeMasks", () => {
  const width = 4;
  const height = 1;
  function maskOf(...values: number[]) {
    const m = createMask(width, height);
    values.forEach((v, i) => {
      m.data[i] = v;
    });
    return m;
  }

  it("returns an empty mask for no contributions", () => {
    expect(Array.from(composeMasks(width, height, []).data)).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it("seeds from the first contribution regardless of its mode", () => {
    const out = composeMasks(width, height, [
      { mask: maskOf(255, 255, 0, 0), mode: "subtract" },
    ]);
    expect(Array.from(out.data)).toEqual([255, 255, 0, 0]);
  });

  it("add takes the union", () => {
    const out = composeMasks(width, height, [
      { mask: maskOf(255, 255, 0, 0), mode: "add" },
      { mask: maskOf(0, 255, 255, 0), mode: "add" },
    ]);
    expect(Array.from(out.data)).toEqual([255, 255, 255, 0]);
  });

  it("subtract removes coverage", () => {
    const out = composeMasks(width, height, [
      { mask: maskOf(255, 255, 255, 0), mode: "add" },
      { mask: maskOf(0, 255, 0, 0), mode: "subtract" },
    ]);
    expect(Array.from(out.data)).toEqual([255, 0, 255, 0]);
  });

  it("intersect keeps only the overlap", () => {
    const out = composeMasks(width, height, [
      { mask: maskOf(255, 255, 0, 0), mode: "add" },
      { mask: maskOf(0, 255, 255, 0), mode: "intersect" },
    ]);
    expect(Array.from(out.data)).toEqual([0, 255, 0, 0]);
  });

  it("preserves feathering through the stack", () => {
    const out = composeMasks(width, height, [
      { mask: maskOf(128, 128, 128, 128), mode: "add" },
      { mask: maskOf(255, 128, 0, 255), mode: "intersect" },
    ]);
    // 128 ∩ 255 = 128, 128 ∩ 128 ≈ 64, 128 ∩ 0 = 0
    expect(out.data[0]).toBeCloseTo(128, -1);
    expect(out.data[1]).toBeCloseTo(64, -1);
    expect(out.data[2]).toBe(0);
  });

  it("rejects a contribution of the wrong size", () => {
    expect(() =>
      composeMasks(width, height, [
        { mask: maskOf(255), mode: "add" },
        { mask: createMask(2, 2), mode: "add" },
      ]),
    ).toThrow(/expected 4x1/);
  });
});
