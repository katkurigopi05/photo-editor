import { describe, expect, it } from "vitest";
import { cubicBezierSchema, animationKeyframeSchema } from "../src/index.js";

/**
 * The shape of a hand-drawn keyframe curve.
 *
 * `x` is bounded and `y` is not, and the asymmetry is the whole point: `x` is
 * time, so a control point outside 0–1 lets the curve double back and give one
 * instant two values; `y` is the animated value, and letting it leave the range
 * is what makes overshoot possible.
 *
 * These exist because a mutation removing the `x` bound passed every other test
 * — the rule was documented and unenforced.
 */

const curve = (over: Record<string, number> = {}) => ({
  x1: 0.42,
  y1: 0,
  x2: 0.58,
  y2: 1,
  ...over,
});

describe("cubicBezierSchema", () => {
  it("accepts a curve inside the bounds", () => {
    expect(cubicBezierSchema.safeParse(curve()).success).toBe(true);
  });

  it("refuses an x outside 0..1, on either control point", () => {
    // Time cannot run backwards. Without this the curve can double back and one
    // instant has two values, which is not an animation.
    for (const over of [{ x1: -0.1 }, { x1: 1.1 }, { x2: -2 }, { x2: 5 }]) {
      expect(cubicBezierSchema.safeParse(curve(over)).success).toBe(false);
    }
  });

  it("accepts the exact endpoints", () => {
    expect(cubicBezierSchema.safeParse(curve({ x1: 0, x2: 1 })).success).toBe(
      true,
    );
  });

  it("allows y outside 0..1, which is what overshoot needs", () => {
    expect(
      cubicBezierSchema.safeParse(curve({ y1: -0.6, y2: 1.6 })).success,
    ).toBe(true);
  });

  it("refuses a non-finite coordinate", () => {
    expect(
      cubicBezierSchema.safeParse(curve({ y1: Number.POSITIVE_INFINITY }))
        .success,
    ).toBe(false);
  });

  it("refuses an unknown key", () => {
    expect(cubicBezierSchema.safeParse({ ...curve(), x3: 0.5 }).success).toBe(
      false,
    );
  });
});

describe("animationKeyframeSchema", () => {
  const keyframe = (over: Record<string, unknown> = {}) => ({
    id: "k1",
    timeUs: "0",
    value: 0,
    easing: "linear",
    ...over,
  });

  it("accepts a keyframe with no curve, unchanged", () => {
    // Every project written before curves existed must still parse.
    expect(animationKeyframeSchema.safeParse(keyframe()).success).toBe(true);
  });

  it("accepts a keyframe carrying a curve", () => {
    expect(
      animationKeyframeSchema.safeParse(keyframe({ bezier: curve() })).success,
    ).toBe(true);
  });

  it("still requires the named easing alongside a curve", () => {
    // The name stays so a curve can be discarded back to something.
    const { easing: _omitted, ...withoutEasing } = keyframe({
      bezier: curve(),
    });
    expect(animationKeyframeSchema.safeParse(withoutEasing).success).toBe(
      false,
    );
  });

  it("refuses a malformed curve rather than ignoring it", () => {
    expect(
      animationKeyframeSchema.safeParse(keyframe({ bezier: curve({ x1: 9 }) }))
        .success,
    ).toBe(false);
  });
});
