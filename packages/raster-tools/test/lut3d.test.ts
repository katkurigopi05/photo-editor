import { describe, expect, it } from "vitest";
import {
  applyLut3d,
  applyLut3dTetrahedral,
  cubeImageToLut,
  identityCubeImage,
  isPointwise,
  LUT_SIZE,
} from "../src/lut3d.js";
import type { RasterImage } from "../src/types.js";

/**
 * 3D colour lookup tables.
 *
 * The claim being tested is a strong one: that grading through a table gives
 * the *same picture* as grading directly, for any stack of pointwise effects.
 * If that does not hold the optimisation is not an optimisation, it is a bug
 * that changes what people's exports look like.
 */

/** A test image covering a wide spread of colours, including the corners. */
function sampleImage(): RasterImage {
  const width = 64;
  const height = 64;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = (x * 4) % 256;
      data[i + 1] = (y * 4) % 256;
      data[i + 2] = (x + y) * 2;
      data[i + 3] = 255;
    }
  }
  // The extremes matter most: black and white are where a table's endpoints
  // either land exactly or drift.
  for (const [at, colour] of [
    [0, [0, 0, 0]],
    [1, [255, 255, 255]],
    [2, [255, 0, 0]],
    [3, [0, 255, 0]],
    [4, [0, 0, 255]],
  ] as const) {
    data[at * 4] = colour[0];
    data[at * 4 + 1] = colour[1];
    data[at * 4 + 2] = colour[2];
  }
  return { width, height, data };
}

/** Grade through a table built from the same function. */
function throughLut(
  image: RasterImage,
  grade: (i: RasterImage) => RasterImage,
): RasterImage {
  const lut = cubeImageToLut(grade(identityCubeImage()));
  return applyLut3d(image, lut);
}

/** Largest per-channel difference between two images. */
function maxDelta(a: RasterImage, b: RasterImage): number {
  let worst = 0;
  for (let i = 0; i < a.data.length; i += 1) {
    if (i % 4 === 3) continue;
    worst = Math.max(worst, Math.abs(a.data[i]! - b.data[i]!));
  }
  return worst;
}

const mapChannels = (
  fn: (r: number, g: number, b: number) => [number, number, number],
) => {
  return (image: RasterImage): RasterImage => {
    const data = new Uint8ClampedArray(image.data);
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = fn(data[i]!, data[i + 1]!, data[i + 2]!);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
    return { width: image.width, height: image.height, data };
  };
};

describe("identityCubeImage", () => {
  it("covers the cube exactly once", () => {
    const cube = identityCubeImage();
    expect(cube.width * cube.height).toBe(LUT_SIZE * LUT_SIZE * LUT_SIZE);
    const seen = new Set<string>();
    for (let i = 0; i < cube.data.length; i += 4) {
      seen.add(`${cube.data[i]},${cube.data[i + 1]},${cube.data[i + 2]}`);
    }
    expect(seen.size).toBe(LUT_SIZE * LUT_SIZE * LUT_SIZE);
  });

  it("includes pure black and pure white", () => {
    // The odd size exists for this: with an even one the top sample misses 255
    // and white drifts, which shows as a tint in a blown highlight.
    const cube = identityCubeImage();
    const seen = new Set<string>();
    for (let i = 0; i < cube.data.length; i += 4) {
      seen.add(`${cube.data[i]},${cube.data[i + 1]},${cube.data[i + 2]}`);
    }
    expect(seen.has("0,0,0")).toBe(true);
    expect(seen.has("255,255,255")).toBe(true);
  });
});

describe("grading through a table matches grading directly", () => {
  it("is exact for the identity", () => {
    const image = sampleImage();
    const identity = (i: RasterImage): RasterImage => i;
    expect(maxDelta(throughLut(image, identity), image)).toBeLessThanOrEqual(1);
  });

  it("matches a per-channel curve closely", () => {
    const grade = mapChannels((r, g, b) => [
      Math.min(255, r * 1.2),
      g,
      Math.max(0, b - 20),
    ]);
    const image = sampleImage();
    expect(
      maxDelta(throughLut(image, grade), grade(image)),
    ).toBeLessThanOrEqual(2);
  });

  it("matches a gentle cross-channel operation almost exactly", () => {
    // Saturation and white balance mix channels, which a per-channel table
    // could not represent at all — this is why the table is three-dimensional.
    const grade = mapChannels((r, g, b) => {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return [
        luma + (r - luma) * 1.15,
        luma + (g - luma) * 1.15,
        luma + (b - luma) * 1.15,
      ];
    });
    const image = sampleImage();
    expect(
      maxDelta(throughLut(image, grade), grade(image)),
    ).toBeLessThanOrEqual(2);
  });

  it("stays within the table's own error even on a harsh, clipping grade", () => {
    // Interpolation error concentrates where the function bends most sharply,
    // which for colour work means where a channel clips. 4/255 is under 2% and
    // below what an eye resolves, but it is not zero and pretending otherwise
    // would make this test a rubber stamp.
    const grade = mapChannels((r, g, b) => {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return [
        luma + (r - luma) * 1.6,
        luma + (g - luma) * 1.6,
        luma + (b - luma) * 1.6,
      ];
    });
    const image = sampleImage();
    expect(
      maxDelta(throughLut(image, grade), grade(image)),
    ).toBeLessThanOrEqual(4);
  });

  it("keeps black black and white white", () => {
    // Endpoint drift is the failure people notice: a grey cast in the shadows
    // of an otherwise untouched picture.
    const identity = (i: RasterImage): RasterImage => i;
    const lut = cubeImageToLut(identity(identityCubeImage()));
    const corners: RasterImage = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]),
    };
    const out = applyLut3d(corners, lut);
    expect([out.data[0], out.data[1], out.data[2]]).toEqual([0, 0, 0]);
    expect([out.data[4], out.data[5], out.data[6]]).toEqual([255, 255, 255]);
  });

  it("leaves alpha untouched", () => {
    const image = sampleImage();
    image.data[3] = 128;
    const lut = cubeImageToLut(identityCubeImage());
    expect(applyLut3d(image, lut).data[3]).toBe(128);
  });

  it("interpolates rather than banding", () => {
    // Nearest-neighbour on 33 samples steps in eights, which is plainly visible
    // on a gradient. A smooth ramp in must stay a smooth ramp out.
    const width = 256;
    const data = new Uint8ClampedArray(width * 4);
    for (let x = 0; x < width; x += 1) {
      data[x * 4] = x;
      data[x * 4 + 1] = x;
      data[x * 4 + 2] = x;
      data[x * 4 + 3] = 255;
    }
    const ramp: RasterImage = { width, height: 1, data };
    const lut = cubeImageToLut(identityCubeImage());
    const out = applyLut3d(ramp, lut);
    let biggestStep = 0;
    for (let x = 1; x < width; x += 1) {
      biggestStep = Math.max(
        biggestStep,
        Math.abs(out.data[x * 4]! - out.data[(x - 1) * 4]!),
      );
    }
    expect(biggestStep).toBeLessThanOrEqual(2);
  });
});

describe("isPointwise", () => {
  it("accepts a function that only reads its own pixel", () => {
    expect(isPointwise(mapChannels((r, g, b) => [g, b, r]))).toBe(true);
  });

  it("rejects one that reads its neighbours", () => {
    // The guard that keeps the runtime's allowlist honest: a blur must never be
    // mistaken for something a table can represent.
    const blur = (image: RasterImage): RasterImage => {
      const data = new Uint8ClampedArray(image.data);
      for (let i = 4; i < data.length - 4; i += 4) {
        for (let c = 0; c < 3; c += 1) {
          data[i + c] = Math.round(
            (image.data[i - 4 + c]! +
              image.data[i + c]! +
              image.data[i + 4 + c]!) /
              3,
          );
        }
      }
      return { width: image.width, height: image.height, data };
    };
    expect(isPointwise(blur)).toBe(false);
  });
});

describe("applyLut3dTetrahedral", () => {
  it("is exact for identity table", () => {
    const image = sampleImage();
    const lut = cubeImageToLut(identityCubeImage());
    const out = applyLut3dTetrahedral(image, lut);
    expect(maxDelta(out, image)).toBeLessThanOrEqual(1);
  });

  it("keeps pure black black and pure white white", () => {
    const lut = cubeImageToLut(identityCubeImage());
    const corners: RasterImage = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]),
    };
    const out = applyLut3dTetrahedral(corners, lut);
    expect([out.data[0], out.data[1], out.data[2]]).toEqual([0, 0, 0]);
    expect([out.data[4], out.data[5], out.data[6]]).toEqual([255, 255, 255]);
  });

  it("leaves alpha channel untouched", () => {
    const image = sampleImage();
    image.data[3] = 128;
    image.data[7] = 64;
    const lut = cubeImageToLut(identityCubeImage());
    const out = applyLut3dTetrahedral(image, lut);
    expect(out.data[3]).toBe(128);
    expect(out.data[7]).toBe(64);
  });

  it("produces smooth non-banding transitions across gradients", () => {
    const width = 256;
    const data = new Uint8ClampedArray(width * 4);
    for (let x = 0; x < width; x += 1) {
      data[x * 4] = x;
      data[x * 4 + 1] = x;
      data[x * 4 + 2] = x;
      data[x * 4 + 3] = 255;
    }
    const ramp: RasterImage = { width, height: 1, data };
    const lut = cubeImageToLut(identityCubeImage());
    const out = applyLut3dTetrahedral(ramp, lut);
    let biggestStep = 0;
    for (let x = 1; x < width; x += 1) {
      biggestStep = Math.max(
        biggestStep,
        Math.abs(out.data[x * 4]! - out.data[(x - 1) * 4]!),
      );
    }
    expect(biggestStep).toBeLessThanOrEqual(2);
  });

  it("agrees closely with trilinear interpolation on smooth photographic colors", () => {
    const image = sampleImage();
    const grade = mapChannels((r, g, b) => {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return [
        Math.min(255, Math.max(0, luma + (r - luma) * 1.2 + 10)),
        Math.min(255, Math.max(0, luma + (g - luma) * 1.1)),
        Math.min(255, Math.max(0, luma + (b - luma) * 0.9 - 5)),
      ];
    });
    const lut = cubeImageToLut(grade(identityCubeImage()));
    const trilinear = applyLut3d(image, lut);
    const tetrahedral = applyLut3dTetrahedral(image, lut);
    // Tetrahedral and trilinear closely track each other while tetrahedral has lower distortion
    expect(maxDelta(trilinear, tetrahedral)).toBeLessThanOrEqual(3);
  });

  it("evaluates all six tetrahedral partitions with exact barycentric weighting", () => {
    // Construct a custom 2x2x2 cube table where each corner is a distinctive value
    const size = 2;
    const lut = new Uint8ClampedArray(size * size * size * 3);
    const cornerVal = (r: number, g: number, b: number) =>
      r * 100 + g * 30 + b * 10;

    for (let b = 0; b < size; b += 1) {
      for (let g = 0; g < size; g += 1) {
        for (let r = 0; r < size; r += 1) {
          const idx = ((b * size + g) * size + r) * 3;
          const v = cornerVal(r, g, b);
          lut[idx] = v;
          lut[idx + 1] = v;
          lut[idx + 2] = v;
        }
      }
    }

    // Six sample points corresponding to the six ordering permutations of (dr, dg, db)
    // Scale for size=2: rf = r * 1/255.
    const samples: Array<{ r: number; g: number; b: number; name: string }> = [
      { r: 204, g: 128, b: 51, name: "dr >= dg >= db" }, // 0.8, 0.5, 0.2
      { r: 204, g: 51, b: 128, name: "dr >= db > dg" }, // 0.8, 0.2, 0.5
      { r: 128, g: 204, b: 51, name: "dg > dr >= db" }, // 0.5, 0.8, 0.2
      { r: 51, g: 204, b: 128, name: "dg >= db > dr" }, // 0.2, 0.8, 0.5
      { r: 128, g: 51, b: 204, name: "db > dr >= dg" }, // 0.5, 0.2, 0.8
      { r: 51, g: 128, b: 204, name: "db >= dg > dr" }, // 0.2, 0.5, 0.8
    ];

    const img: RasterImage = {
      width: samples.length,
      height: 1,
      data: new Uint8ClampedArray(samples.length * 4),
    };

    samples.forEach((s, i) => {
      img.data[i * 4] = s.r;
      img.data[i * 4 + 1] = s.g;
      img.data[i * 4 + 2] = s.b;
      img.data[i * 4 + 3] = 255;
    });

    const out = applyLut3dTetrahedral(img, lut, size);

    // Verify each point's interpolated value matches theoretical simplex sum
    samples.forEach((s, i) => {
      const dr = s.r / 255;
      const dg = s.g / 255;
      const db = s.b / 255;
      let expected: number;

      if (dr >= dg && dg >= db) {
        expected =
          (1 - dr) * cornerVal(0, 0, 0) +
          (dr - dg) * cornerVal(1, 0, 0) +
          (dg - db) * cornerVal(1, 1, 0) +
          db * cornerVal(1, 1, 1);
      } else if (dr >= db && db > dg) {
        expected =
          (1 - dr) * cornerVal(0, 0, 0) +
          (dr - db) * cornerVal(1, 0, 0) +
          (db - dg) * cornerVal(1, 0, 1) +
          dg * cornerVal(1, 1, 1);
      } else if (dg > dr && dr >= db) {
        expected =
          (1 - dg) * cornerVal(0, 0, 0) +
          (dg - dr) * cornerVal(0, 1, 0) +
          (dr - db) * cornerVal(1, 1, 0) +
          db * cornerVal(1, 1, 1);
      } else if (dg >= db && db > dr) {
        expected =
          (1 - dg) * cornerVal(0, 0, 0) +
          (dg - db) * cornerVal(0, 1, 0) +
          (db - dr) * cornerVal(0, 1, 1) +
          dr * cornerVal(1, 1, 1);
      } else if (db > dr && dr >= dg) {
        expected =
          (1 - db) * cornerVal(0, 0, 0) +
          (db - dr) * cornerVal(0, 0, 1) +
          (dr - dg) * cornerVal(1, 0, 1) +
          dg * cornerVal(1, 1, 1);
      } else {
        expected =
          (1 - db) * cornerVal(0, 0, 0) +
          (db - dg) * cornerVal(0, 0, 1) +
          (dg - dr) * cornerVal(0, 1, 1) +
          dr * cornerVal(1, 1, 1);
      }

      expect(
        Math.abs(out.data[i * 4]! - Math.round(expected)),
      ).toBeLessThanOrEqual(1);
    });
  });
});
