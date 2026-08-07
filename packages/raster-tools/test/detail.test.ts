import { describe, expect, it } from "vitest";
import { createImage, createMask, pixelIndex } from "../src/types.js";
import { colorGrading } from "../src/adjust.js";
import { clarity, texture, dehaze, noiseReduction } from "../src/detail.js";

/**
 * The Effects and Detail panels, plus three-way colour grading.
 *
 * These are the entries the Lightroom reference note lists that nothing
 * implemented: colour grading wheels, Clarity/Texture/Dehaze, and noise
 * reduction split into luminance and colour. Each is pinned by the property
 * that makes it that control rather than a neighbouring one — Clarity works at
 * a coarser radius than Texture, Dehaze stretches contrast where the frame is
 * flat and low-saturation, and colour noise reduction must not soften detail
 * the way luminance reduction does.
 */

/** A flat mid-grey field. */
function flat(width: number, height: number, value = 128) {
  const image = createImage(width, height);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  return image;
}

/** Fine checkerboard: detail at the smallest possible scale. */
function checkerboard(size: number, a = 90, b = 165) {
  const image = createImage(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = pixelIndex(x, y, size);
      const v = (x + y) % 2 === 0 ? a : b;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
  }
  return image;
}

/** Broad light/dark halves: detail at a coarse scale. */
function halves(size: number, a = 90, b = 165) {
  const image = createImage(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = pixelIndex(x, y, size);
      const v = x < size / 2 ? a : b;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
  }
  return image;
}

/** Largest difference between neighbouring pixels — how sharp the sharpest
 * transition is. */
function steepestEdge(image: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}): number {
  let worst = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x + 1 < image.width; x++) {
      const a = pixelIndex(x, y, image.width);
      const b = pixelIndex(x + 1, y, image.width);
      worst = Math.max(worst, Math.abs(image.data[a]! - image.data[b]!));
    }
  }
  return worst;
}

/** Mean absolute difference between neighbouring pixels — local contrast. */
function localContrast(image: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}): number {
  let total = 0;
  let pairs = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x + 1 < image.width; x++) {
      const a = pixelIndex(x, y, image.width);
      const b = pixelIndex(x + 1, y, image.width);
      total += Math.abs(image.data[a]! - image.data[b]!);
      pairs++;
    }
  }
  return total / Math.max(1, pairs);
}

describe("clarity", () => {
  it("is an exact no-op at 0", () => {
    const image = halves(16);
    expect(Array.from(clarity(image, 0).data)).toEqual(Array.from(image.data));
  });

  it("raises midtone local contrast at a coarse radius", () => {
    const image = halves(32);
    const out = clarity(image, 80);
    expect(localContrast(out)).toBeGreaterThan(localContrast(image));
  });

  it("softens the edge when negative", () => {
    // Mean neighbour difference cannot see this: across a monotone step it
    // sums to the same total however gently the step is shaped. The steepest
    // single transition is what softening actually changes.
    const image = halves(32);
    const out = clarity(image, -80);
    expect(steepestEdge(out)).toBeLessThan(steepestEdge(image));
  });

  it("leaves a flat field flat", () => {
    // Nothing to add contrast to; a pass that invents structure here would be
    // amplifying noise, not clarity.
    const out = clarity(flat(16, 16), 100);
    const first = out.data[0]!;
    for (let i = 0; i < out.data.length; i += 4) {
      expect(Math.abs(out.data[i]! - first)).toBeLessThanOrEqual(1);
    }
  });

  it("leaves alpha untouched and does not mutate its input", () => {
    const image = halves(8);
    const before = Array.from(image.data);
    const out = clarity(image, 50);
    expect(out.data[3]).toBe(255);
    expect(Array.from(image.data)).toEqual(before);
  });

  it("honours a mask", () => {
    const image = halves(16);
    const mask = createMask(16, 16);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 8; x++) mask.data[y * 16 + x] = 255;
    }
    const out = clarity(image, 100, mask);
    // Right half untouched.
    for (let y = 0; y < 16; y++) {
      const p = pixelIndex(12, y, 16);
      expect(out.data[p]).toBe(image.data[p]);
    }
  });
});

describe("texture", () => {
  it("is an exact no-op at 0", () => {
    const image = checkerboard(16);
    expect(Array.from(texture(image, 0).data)).toEqual(Array.from(image.data));
  });

  it("works at a finer scale than clarity", () => {
    // The distinction between the two controls: on fine detail texture bites
    // and clarity barely moves; that is what the radius difference buys.
    const fine = checkerboard(32);
    const textured = localContrast(texture(fine, 100));
    const clarified = localContrast(clarity(fine, 100));
    const base = localContrast(fine);
    expect(textured - base).toBeGreaterThan(clarified - base);
  });

  it("smooths fine detail when negative", () => {
    const fine = checkerboard(32);
    expect(localContrast(texture(fine, -100))).toBeLessThan(
      localContrast(fine),
    );
  });
});

describe("dehaze", () => {
  it("is an exact no-op at 0", () => {
    const image = halves(16);
    expect(Array.from(dehaze(image, 0).data)).toEqual(Array.from(image.data));
  });

  it("expands a washed-out frame toward the full tonal range", () => {
    // Haze compresses everything into a narrow, bright, low-saturation band.
    const hazy = createImage(32, 1);
    for (let x = 0; x < 32; x++) {
      const p = pixelIndex(x, 0, 32);
      const v = 150 + Math.round((x / 31) * 30); // 150..180
      hazy.data[p] = hazy.data[p + 1] = hazy.data[p + 2] = v;
      hazy.data[p + 3] = 255;
    }
    const out = dehaze(hazy, 100);
    const spread = (image: { data: Uint8ClampedArray }): number => {
      let min = 255;
      let max = 0;
      for (let i = 0; i < image.data.length; i += 4) {
        min = Math.min(min, image.data[i]!);
        max = Math.max(max, image.data[i]!);
      }
      return max - min;
    };
    expect(spread(out)).toBeGreaterThan(spread(hazy) * 1.5);
  });

  it("adds haze when negative", () => {
    const image = halves(32, 20, 235);
    const out = dehaze(image, -100);
    expect(localContrast(out)).toBeLessThan(localContrast(image));
  });

  it("keeps output in range at full strength", () => {
    const out = dehaze(halves(16, 5, 250), 100);
    for (const v of out.data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});

describe("noiseReduction", () => {
  /** A grey field with per-pixel luminance noise and one strong colour speckle. */
  function noisy(size: number) {
    const image = createImage(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const p = pixelIndex(x, y, size);
        const jitter = (x * 7 + y * 13) % 2 === 0 ? 18 : -18;
        image.data[p] = 128 + jitter;
        image.data[p + 1] = 128 + jitter;
        image.data[p + 2] = 128 + jitter;
        image.data[p + 3] = 255;
      }
    }
    // One pixel with a hard colour cast, luminance unchanged.
    const speckle = pixelIndex(size >> 1, size >> 1, size);
    image.data[speckle] = 210;
    image.data[speckle + 2] = 40;
    return image;
  }

  it("is an exact no-op at zero for both channels", () => {
    const image = noisy(16);
    expect(Array.from(noiseReduction(image, 0, 0).data)).toEqual(
      Array.from(image.data),
    );
  });

  it("reduces luminance noise", () => {
    const image = noisy(24);
    const out = noiseReduction(image, 100, 0);
    expect(localContrast(out)).toBeLessThan(localContrast(image));
  });

  it("removes a colour speckle without softening luminance detail", () => {
    // The reason the two controls are separate: colour noise can be smoothed
    // hard, because the eye reads chroma at low resolution, while the same
    // treatment on luminance destroys the picture.
    const image = noisy(24);
    const centre = pixelIndex(12, 12, 24);
    const before = image.data[centre]! - image.data[centre + 2]!;

    const out = noiseReduction(image, 0, 100);
    const after = out.data[centre]! - out.data[centre + 2]!;
    expect(Math.abs(after)).toBeLessThan(Math.abs(before) / 2);
    // Luminance structure survives untouched.
    expect(localContrast(out)).toBeCloseTo(localContrast(image), 0);
  });

  it("leaves alpha untouched", () => {
    const image = noisy(8);
    image.data[3] = 90;
    expect(noiseReduction(image, 100, 100).data[3]).toBe(90);
  });
});

describe("colorGrading", () => {
  const grey = flat(8, 8);

  it("is an exact no-op with no wheels set", () => {
    expect(Array.from(colorGrading(grey, {}).data)).toEqual(
      Array.from(grey.data),
    );
  });

  it("tints shadows without moving highlights", () => {
    const ramp = createImage(2, 1);
    // One dark pixel, one bright pixel.
    ramp.data.set([30, 30, 30, 255, 225, 225, 225, 255]);
    const out = colorGrading(ramp, {
      shadows: { hue: 240, saturation: 100 }, // blue
    });
    expect(out.data[2]).toBeGreaterThan(30); // shadow blue lifted
    expect(Math.abs(out.data[6]! - 225)).toBeLessThan(6); // highlight ~unchanged
  });

  it("tints highlights without moving shadows", () => {
    const ramp = createImage(2, 1);
    ramp.data.set([30, 30, 30, 255, 225, 225, 225, 255]);
    const out = colorGrading(ramp, {
      highlights: { hue: 40, saturation: 100 }, // amber
    });
    expect(out.data[4]).toBeGreaterThan(225 - 2);
    expect(Math.abs(out.data[0]! - 30)).toBeLessThan(6);
  });

  it("shifts which tones count as shadow with balance", () => {
    const mid = flat(4, 4, 128);
    const neutral = colorGrading(mid, {
      shadows: { hue: 240, saturation: 100 },
      balance: 0,
    });
    const towardShadows = colorGrading(mid, {
      shadows: { hue: 240, saturation: 100 },
      balance: -100,
    });
    // Negative balance moves the boundary up, so a midtone falls inside the
    // shadow band and picks up its tint.
    expect(towardShadows.data[2]).toBeGreaterThan(neutral.data[2]!);
  });

  it("applies midtone tint most strongly in the middle of the range", () => {
    const ramp = createImage(3, 1);
    ramp.data.set([20, 20, 20, 255, 128, 128, 128, 255, 235, 235, 235, 255]);
    const out = colorGrading(ramp, { midtones: { hue: 120, saturation: 100 } });
    const lift = (i: number): number => out.data[i + 1]! - ramp.data[i + 1]!;
    expect(lift(4)).toBeGreaterThan(lift(0));
    expect(lift(4)).toBeGreaterThan(lift(8));
  });

  it("keeps output in range and alpha untouched", () => {
    const out = colorGrading(flat(4, 4, 250), {
      shadows: { hue: 0, saturation: 100 },
      midtones: { hue: 120, saturation: 100 },
      highlights: { hue: 240, saturation: 100 },
    });
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBeGreaterThanOrEqual(0);
      expect(out.data[i]).toBeLessThanOrEqual(255);
      expect(out.data[i + 3]).toBe(255);
    }
  });

  it("honours a mask", () => {
    const image = flat(4, 1);
    const mask = createMask(4, 1);
    mask.data[0] = 255;
    const out = colorGrading(
      image,
      { shadows: { hue: 240, saturation: 100 } },
      mask,
    );
    expect(out.data[4]).toBe(128);
  });
});
