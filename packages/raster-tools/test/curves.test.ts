import { describe, expect, it } from "vitest";
import { buildCurveLut, curvePoint, IDENTITY_CURVE } from "../src/curves.js";

/**
 * Control-point curves.
 *
 * A curve is a handful of points and a rule for the space between them. The
 * rule here is monotone cubic (Fritsch–Carlson), and the reason is the one
 * property a tone curve must have: it may never go where the points do not
 * send it. An ordinary cubic spline overshoots between points, which on a
 * picture reads as a halo above a highlight or a crushed band below a shadow
 * that nobody asked for.
 */

const at = (points: readonly { x: number; y: number }[], x: number) =>
  curvePoint(points, x);

describe("curvePoint", () => {
  it("leaves the identity curve alone", () => {
    for (const x of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(at(IDENTITY_CURVE, x)).toBeCloseTo(x, 6);
    }
  });

  it("passes exactly through every control point", () => {
    // The whole contract of a control point: the curve is *there*, not near it.
    const points = [
      { x: 0, y: 0 },
      { x: 0.25, y: 0.5 },
      { x: 0.75, y: 0.4 },
      { x: 1, y: 1 },
    ];
    for (const p of points) {
      expect(at(points, p.x)).toBeCloseTo(p.y, 6);
    }
  });

  it("never overshoots between points", () => {
    // The reason for monotone cubic rather than a plain spline. A natural
    // cubic through these points swings above 0.9 and below 0.1; this must
    // stay inside the box its neighbours define.
    const points = [
      { x: 0, y: 0.1 },
      { x: 0.3, y: 0.9 },
      { x: 0.6, y: 0.9 },
      { x: 1, y: 0.1 },
    ];
    for (let i = 0; i <= 200; i += 1) {
      const y = at(points, i / 200);
      expect(y).toBeGreaterThanOrEqual(0.1 - 1e-9);
      expect(y).toBeLessThanOrEqual(0.9 + 1e-9);
    }
  });

  it("stays monotone where the points are monotone", () => {
    // A rising curve that dips would darken a pixel brighter than its
    // neighbour, which is visible as a false edge.
    const points = [
      { x: 0, y: 0 },
      { x: 0.2, y: 0.05 },
      { x: 0.8, y: 0.95 },
      { x: 1, y: 1 },
    ];
    let previous = -Infinity;
    for (let i = 0; i <= 500; i += 1) {
      const y = at(points, i / 500);
      expect(y).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = y;
    }
  });

  it("clamps outside the curve's own range", () => {
    const points = [
      { x: 0, y: 0.2 },
      { x: 1, y: 0.8 },
    ];
    expect(at(points, -1)).toBeCloseTo(0.2, 6);
    expect(at(points, 2)).toBeCloseTo(0.8, 6);
  });

  it("handles a two-point curve as a straight line", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0.5 },
    ];
    expect(at(points, 0.5)).toBeCloseTo(0.25, 6);
  });
});

describe("buildCurveLut", () => {
  it("is 256 entries of bytes", () => {
    const lut = buildCurveLut(IDENTITY_CURVE);
    expect(lut).toHaveLength(256);
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
  });

  it("maps the identity curve to itself exactly", () => {
    // A LUT that shifted by one would tint every untouched picture.
    const lut = buildCurveLut(IDENTITY_CURVE);
    for (let i = 0; i < 256; i += 1) expect(lut[i]).toBe(i);
  });

  it("clamps into byte range rather than wrapping", () => {
    // Wrapping is the classic curve bug: a value pushed past white comes back
    // as black, so a blown highlight turns into a hole.
    const lut = buildCurveLut([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
    for (let i = 0; i < 256; i += 1) expect(lut[i]).toBe(255);

    const dark = buildCurveLut([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    for (let i = 0; i < 256; i += 1) expect(dark[i]).toBe(0);
  });
});
