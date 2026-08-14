import { describe, expect, it } from "vitest";
import {
  applyColourTransform,
  cameraToSrgb,
  invert3,
  multiply3,
  XYZ_D50_TO_SRGB,
  type Matrix3,
} from "../src/colour.js";

/**
 * Colour.
 *
 * The property everything here is judged against is **neutral in, neutral
 * out**. It can be asserted without a reference image, it is what a user
 * notices immediately when it is wrong, and a residual tint survives every
 * later adjustment — they would correct it by eye on every photograph and never
 * find the cause.
 */

const IDENTITY: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** A plausible XYZ→camera matrix, in the shape and sign pattern DNG uses: a
 * positive diagonal with negative off-diagonal terms. */
const CAMERA: Matrix3 = [
  0.6722, -0.635, -0.0963, -0.4287, 1.246, 0.2028, -0.0908, 0.2162, 0.5668,
];

describe("multiply3", () => {
  it("leaves a matrix unchanged when multiplied by the identity", () => {
    expect([...multiply3(CAMERA, IDENTITY)]).toEqual([...CAMERA]);
    expect([...multiply3(IDENTITY, CAMERA)]).toEqual([...CAMERA]);
  });

  it("multiplies in the right order", () => {
    // Order matters and swapping it is silent, so this uses two matrices that
    // do not commute.
    const a: Matrix3 = [1, 2, 0, 0, 1, 0, 0, 0, 1];
    const b: Matrix3 = [1, 0, 0, 3, 1, 0, 0, 0, 1];
    expect([...multiply3(a, b)]).toEqual([7, 2, 0, 3, 1, 0, 0, 0, 1]);
    expect([...multiply3(b, a)]).toEqual([1, 2, 0, 3, 7, 0, 0, 0, 1]);
  });
});

describe("invert3", () => {
  it("inverts the identity to itself", () => {
    // Compared numerically rather than with toEqual: cofactor expansion
    // produces -0 for some off-diagonal entries, which toEqual treats as
    // different from 0 while every arithmetic use of it does not.
    [...invert3(IDENTITY)!].forEach((v, i) => {
      expect(v).toBeCloseTo(IDENTITY[i]!, 12);
    });
  });

  it("produces a true inverse", () => {
    const inv = invert3(CAMERA)!;
    const product = multiply3(CAMERA, inv);
    [...product].forEach((v, i) => {
      expect(v).toBeCloseTo(IDENTITY[i]!, 6);
    });
  });

  it("refuses a singular matrix rather than returning infinities", () => {
    // Two identical rows. Returning a matrix of Infinity here would surface as
    // every pixel becoming NaN three stages later, which is far harder to
    // diagnose than a refusal.
    expect(invert3([1, 2, 3, 1, 2, 3, 4, 5, 6])).toBeNull();
  });

  it("refuses a near-singular matrix too", () => {
    // Finite but useless: the inverse would be enormous and the picture would
    // be garbage rather than obviously broken.
    expect(invert3([1, 0, 0, 0, 1, 0, 0, 0, 1e-15])).toBeNull();
  });
});

describe("cameraToSrgb", () => {
  it("maps neutral to neutral", () => {
    // The load-bearing property. A camera reading of equal channels must come
    // out as equal channels, or every photograph carries a tint.
    const t = cameraToSrgb(CAMERA)!;
    const m = t.matrix;
    const r = m[0]! + m[1]! + m[2]!;
    const g = m[3]! + m[4]! + m[5]!;
    const b = m[6]! + m[7]! + m[8]!;
    expect(r).toBeCloseTo(1, 6);
    expect(g).toBeCloseTo(1, 6);
    expect(b).toBeCloseTo(1, 6);
  });

  it("still maps neutral to neutral once white balance is applied", () => {
    // White balance changes the matrix; it must not break the invariant.
    const t = cameraToSrgb(CAMERA, [0.52, 1.0, 0.72])!;
    for (let row = 0; row < 3; row += 1) {
      const sum =
        t.matrix[row * 3]! + t.matrix[row * 3 + 1]! + t.matrix[row * 3 + 2]!;
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it("actually uses the white balance rather than ignoring it", () => {
    // Both matrices satisfy the neutral invariant, so the invariant alone
    // cannot tell whether the neutral was applied. This checks they differ.
    const plain = cameraToSrgb(CAMERA)!;
    const balanced = cameraToSrgb(CAMERA, [0.52, 1.0, 0.72])!;
    const differences = [...plain.matrix].map((v, i) =>
      Math.abs(v - balanced.matrix[i]!),
    );
    expect(Math.max(...differences)).toBeGreaterThan(0.05);
  });

  it("ignores a neutral of the wrong length rather than misreading it", () => {
    const t = cameraToSrgb(CAMERA, [0.5, 1.0])!;
    expect([...t.matrix]).toEqual([...cameraToSrgb(CAMERA)!.matrix]);
  });

  it("survives a zero in the neutral instead of dividing by it", () => {
    const t = cameraToSrgb(CAMERA, [0, 1, 1]);
    expect(t).not.toBeNull();
    expect([...t!.matrix].every(Number.isFinite)).toBe(true);
  });

  it("refuses a singular colour matrix", () => {
    expect(cameraToSrgb([1, 1, 1, 1, 1, 1, 1, 1, 1])).toBeNull();
  });
});

describe("applyColourTransform", () => {
  it("leaves an image alone under the identity", () => {
    const image = {
      width: 1,
      height: 2,
      rgb: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]),
    };
    const out = applyColourTransform(image, { matrix: IDENTITY });
    [...out.rgb].forEach((v, i) => expect(v).toBeCloseTo(image.rgb[i]!, 6));
  });

  it("keeps neutral neutral end to end", () => {
    // The invariant, applied to actual pixels rather than to the matrix.
    const t = cameraToSrgb(CAMERA, [0.52, 1.0, 0.72])!;
    const image = {
      width: 1,
      height: 1,
      rgb: new Float32Array([0.5, 0.5, 0.5]),
    };
    const out = applyColourTransform(image, t);
    expect(out.rgb[0]).toBeCloseTo(0.5, 5);
    expect(out.rgb[1]).toBeCloseTo(0.5, 5);
    expect(out.rgb[2]).toBeCloseTo(0.5, 5);
  });

  it("clamps negatives rather than letting them through", () => {
    // A colour matrix routinely produces negatives for saturated subjects.
    // Left alone they make the sRGB encoder return NaN, which appears as black
    // speckle in exactly the most colourful parts of the frame.
    const out = applyColourTransform(
      { width: 1, height: 1, rgb: new Float32Array([1, 0, 0]) },
      { matrix: [-1, 0, 0, 0, -1, 0, 0, 0, -1] },
    );
    expect([...out.rgb]).toEqual([0, 0, 0]);
  });

  it("clamps above one as well", () => {
    const out = applyColourTransform(
      { width: 1, height: 1, rgb: new Float32Array([1, 1, 1]) },
      { matrix: [5, 0, 0, 0, 5, 0, 0, 0, 5] },
    );
    expect([...out.rgb]).toEqual([1, 1, 1]);
  });
});

describe("XYZ_D50_TO_SRGB", () => {
  it("is invertible", () => {
    expect(invert3(XYZ_D50_TO_SRGB)).not.toBeNull();
  });

  it("maps D50 white to equal sRGB channels", () => {
    // The matrix is Bradford-adapted, so D50's white point — not D65's —
    // is what must come out neutral. Using the unadapted D65 matrix here
    // leaves a slight warm cast on everything.
    const d50: [number, number, number] = [0.9642, 1.0, 0.8249];
    const m = XYZ_D50_TO_SRGB;
    const out = [0, 1, 2].map(
      (row) =>
        m[row * 3]! * d50[0] +
        m[row * 3 + 1]! * d50[1] +
        m[row * 3 + 2]! * d50[2],
    );
    expect(out[0]).toBeCloseTo(1, 3);
    expect(out[1]).toBeCloseTo(1, 3);
    expect(out[2]).toBeCloseTo(1, 3);
  });
});
