import { describe, expect, it } from "vitest";
import {
  applyAnimationEasing,
  applyBezierEasing,
  easeKeyframe,
  sampleAnimationTrack,
} from "../src/index.js";
import type { AnimationTrack } from "@director/project-schema";

/**
 * Hand-drawn keyframe curves.
 *
 * The property that anchors these: a custom curve using CSS's own control
 * points must produce exactly what the named easing produces. It proves the two
 * paths share one solver rather than being separate implementations that agree
 * today and drift later — which is how a preview and an export start
 * disagreeing.
 */

const EASE_IN = { x1: 0.42, y1: 0, x2: 1, y2: 1 };
const EASE_IN_OUT = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };

const track = (keyframes: AnimationTrack["keyframes"]): AnimationTrack =>
  ({ id: "t", property: "transform.position_x", keyframes }) as AnimationTrack;

const kf = (
  timeUs: string,
  value: number,
  extra: Record<string, unknown> = {},
) => ({ id: `k${timeUs}`, timeUs, value, easing: "linear", ...extra }) as never;

describe("applyBezierEasing", () => {
  it("matches the named easing it was built from", () => {
    // The load-bearing property: one solver, not two.
    for (const p of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(applyBezierEasing(EASE_IN, p)).toBeCloseTo(
        applyAnimationEasing("ease-in", p),
        9,
      );
      expect(applyBezierEasing(EASE_IN_OUT, p)).toBeCloseTo(
        applyAnimationEasing("ease-in-out", p),
        9,
      );
    }
  });

  it("pins the ends exactly", () => {
    // A curve that does not start at 0 or end at 1 makes an animation jump at
    // its own keyframes.
    expect(applyBezierEasing({ x1: 0.9, y1: 0.1, x2: 0.1, y2: 0.9 }, 0)).toBe(
      0,
    );
    expect(applyBezierEasing({ x1: 0.9, y1: 0.1, x2: 0.1, y2: 0.9 }, 1)).toBe(
      1,
    );
  });

  it("clamps progress outside 0..1 rather than extrapolating", () => {
    expect(applyBezierEasing(EASE_IN, -1)).toBe(0);
    expect(applyBezierEasing(EASE_IN, 2)).toBe(1);
  });

  it("refuses non-finite progress instead of returning NaN", () => {
    expect(() => applyBezierEasing(EASE_IN, Number.NaN)).toThrow(RangeError);
  });

  it("overshoots when the control points ask it to", () => {
    // The reason y is unbounded while x is not. A move that goes past its
    // target and settles is the point of drawing a curve by hand.
    const anticipate = { x1: 0.3, y1: -0.6, x2: 0.7, y2: 1.6 };
    const samples = [0.2, 0.4, 0.6, 0.8].map((p) =>
      applyBezierEasing(anticipate, p),
    );
    expect(Math.min(...samples)).toBeLessThan(0);
    expect(Math.max(...samples)).toBeGreaterThan(1);
  });

  it("is monotonic in time for a well-formed curve", () => {
    // x bounded to 0..1 is what guarantees this: the curve cannot double back
    // so one instant has two values.
    let previous = -Infinity;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const v = applyBezierEasing(EASE_IN_OUT, p);
      expect(v).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = v;
    }
  });
});

describe("easeKeyframe", () => {
  it("uses the curve when there is one", () => {
    const withCurve = { easing: "linear" as const, bezier: EASE_IN };
    expect(easeKeyframe(withCurve, 0.3)).toBeCloseTo(
      applyAnimationEasing("ease-in", 0.3),
      9,
    );
    // And is not simply linear, which is what it would be if the curve were
    // ignored.
    expect(easeKeyframe(withCurve, 0.3)).not.toBeCloseTo(0.3, 3);
  });

  it("falls back to the named easing when there is none", () => {
    expect(easeKeyframe({ easing: "ease-out" }, 0.3)).toBeCloseTo(
      applyAnimationEasing("ease-out", 0.3),
      9,
    );
  });
});

describe("sampleAnimationTrack with a curve", () => {
  it("shapes the span leaving the keyframe that carries it", () => {
    // The left keyframe governs the span after it, which is what the curve
    // appears to do when drawn beside that keyframe.
    const linear = track([kf("0", 0), kf("1000000", 100)]);
    const eased = track([kf("0", 0, { bezier: EASE_IN }), kf("1000000", 100)]);
    const at = (t: AnimationTrack) => sampleAnimationTrack(t, "250000");
    expect(at(linear)).toBeCloseTo(25, 6);
    // ease-in is slow to start, so a quarter of the way through it has moved
    // markedly less than a quarter of the distance.
    expect(at(eased)).toBeLessThan(20);
    expect(at(eased)).toBeGreaterThan(0);
  });

  it("still lands exactly on both keyframe values", () => {
    // Whatever the curve, the animation must pass through the values that were
    // keyed — otherwise the numbers in the inspector are not what is drawn.
    const t = track([
      kf("0", 10, { bezier: { x1: 0.9, y1: -0.5, x2: 0.1, y2: 1.5 } }),
      kf("1000000", 90),
    ]);
    expect(sampleAnimationTrack(t, "0")).toBeCloseTo(10, 9);
    expect(sampleAnimationTrack(t, "1000000")).toBeCloseTo(90, 9);
  });

  it("leaves a track without curves exactly as it was", () => {
    // A project written before custom curves existed must sample identically.
    const t = track([
      kf("0", 0, { easing: "ease-in-out" }),
      kf("1000000", 100),
    ]);
    for (const time of ["0", "250000", "500000", "750000", "1000000"]) {
      expect(sampleAnimationTrack(t, time)).toBeCloseTo(
        0 + 100 * applyAnimationEasing("ease-in-out", Number(time) / 1_000_000),
        6,
      );
    }
  });
});
