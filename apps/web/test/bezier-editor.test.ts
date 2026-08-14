import { describe, expect, it } from "vitest";
import {
  applyAnimationEasing,
  applyBezierEasing,
} from "@director/playback-controller";
import {
  clampControlPoint,
  curveForEasing,
  curvePoint,
  fromCanvas,
  handleAt,
  overshoots,
  toCanvas,
  withHandle,
  Y_MAX,
  Y_MIN,
} from "../src/bezier-editor.js";

/**
 * The geometry behind the curve editor.
 *
 * Everything here is the part that decides where a handle *is*, separately from
 * the part that paints it — because a mapping that is off by its padding still
 * draws a perfectly plausible curve, and the only way that shows up is a handle
 * that does not sit under the pointer dragging it.
 */

const VIEW = { width: 220, height: 220 };
const EASE_IN_OUT = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };

describe("coordinate mapping", () => {
  it("round-trips a point through canvas space", () => {
    // The property that matters: whatever the padding and the overshoot margin
    // are, a point taken to pixels and back is the point you started with.
    for (const point of [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0.42, y: 0 },
      { x: 0.3, y: -0.4 },
      { x: 0.7, y: 1.5 },
    ]) {
      const back = fromCanvas(toCanvas(point, VIEW), VIEW);
      expect(back.x).toBeCloseTo(point.x, 10);
      expect(back.y).toBeCloseTo(point.y, 10);
    }
  });

  it("puts y=1 above y=0 on the canvas", () => {
    // Canvas y grows downward. Getting this backwards draws every curve upside
    // down, which reads as ease-out when the keyframe says ease-in — a picture
    // that is wrong in a way the numbers beside it do not reveal.
    expect(toCanvas({ x: 0, y: 1 }, VIEW).y).toBeLessThan(
      toCanvas({ x: 0, y: 0 }, VIEW).y,
    );
  });

  it("leaves room above and below the unit square", () => {
    // Overshoot is the reason to draw a curve by hand. If the visible range
    // stopped at 0 and 1 the curve would be clipped exactly where it matters.
    const top = toCanvas({ x: 0.5, y: 1 }, VIEW).y;
    const above = toCanvas({ x: 0.5, y: Y_MAX }, VIEW).y;
    expect(above).toBeLessThan(top);
    const bottom = toCanvas({ x: 0.5, y: 0 }, VIEW).y;
    const below = toCanvas({ x: 0.5, y: Y_MIN }, VIEW).y;
    expect(below).toBeGreaterThan(bottom);
  });
});

describe("clampControlPoint", () => {
  it("holds x inside 0–1 because x is time", () => {
    // A control point outside the range lets the curve double back, so one
    // instant would have two values.
    expect(clampControlPoint({ x: -0.4, y: 0.5 }).x).toBe(0);
    expect(clampControlPoint({ x: 1.8, y: 0.5 }).x).toBe(1);
  });

  it("lets y leave 0–1, which is what makes overshoot possible", () => {
    expect(clampControlPoint({ x: 0.5, y: 1.4 }).y).toBeCloseTo(1.4);
    expect(clampControlPoint({ x: 0.5, y: -0.4 }).y).toBeCloseTo(-0.4);
  });

  it("still stops y at the edge of what is drawn", () => {
    expect(clampControlPoint({ x: 0.5, y: 99 }).y).toBe(Y_MAX);
    expect(clampControlPoint({ x: 0.5, y: -99 }).y).toBe(Y_MIN);
  });
});

describe("handleAt", () => {
  it("grabs the handle under the pointer", () => {
    const first = toCanvas({ x: EASE_IN_OUT.x1, y: EASE_IN_OUT.y1 }, VIEW);
    expect(handleAt(first, EASE_IN_OUT, VIEW)).toBe(1);
    const second = toCanvas({ x: EASE_IN_OUT.x2, y: EASE_IN_OUT.y2 }, VIEW);
    expect(handleAt(second, EASE_IN_OUT, VIEW)).toBe(2);
  });

  it("grabs nothing in empty space", () => {
    expect(handleAt({ x: 5, y: 5 }, EASE_IN_OUT, VIEW)).toBe(null);
  });

  it("keeps two handles separable when they coincide", () => {
    // Drag one onto the other and the second must still be the one picked up,
    // or it is stuck underneath the first for good.
    const stacked = { x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 };
    const at = toCanvas({ x: 0.5, y: 0.5 }, VIEW);
    expect(handleAt(at, stacked, VIEW)).toBe(2);
  });
});

describe("withHandle", () => {
  it("moves only the handle asked for", () => {
    const moved = withHandle(EASE_IN_OUT, 1, { x: 0.1, y: 0.9 });
    expect(moved.x1).toBeCloseTo(0.1);
    expect(moved.y1).toBeCloseTo(0.9);
    expect(moved.x2).toBe(EASE_IN_OUT.x2);
    expect(moved.y2).toBe(EASE_IN_OUT.y2);
  });

  it("does not mutate the curve it was given", () => {
    const before = { ...EASE_IN_OUT };
    withHandle(EASE_IN_OUT, 2, { x: 0.2, y: 0.2 });
    expect(EASE_IN_OUT).toEqual(before);
  });

  it("clamps as it moves", () => {
    expect(withHandle(EASE_IN_OUT, 2, { x: 3, y: 0.5 }).x2).toBe(1);
  });
});

describe("curvePoint", () => {
  it("starts at the origin and ends at the far corner", () => {
    expect(curvePoint(EASE_IN_OUT, 0)).toEqual({ x: 0, y: 0 });
    const end = curvePoint(EASE_IN_OUT, 1);
    expect(end.x).toBeCloseTo(1);
    expect(end.y).toBeCloseTo(1);
  });

  it("draws the same curve the playback engine evaluates", () => {
    // The editor and the renderer must agree, or the preview shows one motion
    // and the export another. Sampling by parameter gives (x, y) pairs; asking
    // the engine for its value at that same x must return that same y.
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const point = curvePoint(EASE_IN_OUT, t);
      expect(applyBezierEasing(EASE_IN_OUT, point.x)).toBeCloseTo(point.y, 3);
    }
  });

  it("agrees with the engine on an overshooting curve too", () => {
    const springy = { x1: 0.2, y1: 1.6, x2: 0.4, y2: 1 };
    for (const t of [0.2, 0.5, 0.8]) {
      const point = curvePoint(springy, t);
      expect(applyBezierEasing(springy, point.x)).toBeCloseTo(point.y, 3);
    }
  });
});

describe("curveForEasing", () => {
  it("returns the control points CSS uses for each named easing", () => {
    // Opening the editor must start from the curve the keyframe already has,
    // or the first thing it does is silently change the animation.
    expect(curveForEasing("ease-in")).toEqual({ x1: 0.42, y1: 0, x2: 1, y2: 1 });
    expect(curveForEasing("linear")).toEqual({ x1: 0, y1: 0, x2: 1, y2: 1 });
  });

  it("produces the motion the named easing already produced", () => {
    // The claim that matters, checked against the engine's *named* path rather
    // than against a second copy of the same control points: opening the editor
    // on an ease-in keyframe and saving without touching anything must leave
    // the animation moving exactly as it did.
    for (const easing of ["linear", "ease-in", "ease-out", "ease-in-out"]) {
      const curve = curveForEasing(easing);
      for (const progress of [0.2, 0.5, 0.8]) {
        expect(applyBezierEasing(curve, progress)).toBeCloseTo(
          applyAnimationEasing(
            easing as Parameters<typeof applyAnimationEasing>[0],
            progress,
          ),
          6,
        );
      }
    }
  });

  it("falls back rather than returning undefined for an unknown name", () => {
    expect(curveForEasing("no-such-easing")).toEqual(
      curveForEasing("ease-in-out"),
    );
  });
});

describe("overshoots", () => {
  it("is false for every named easing", () => {
    for (const easing of ["linear", "ease-in", "ease-out", "ease-in-out"]) {
      expect(overshoots(curveForEasing(easing))).toBe(false);
    }
  });

  it("is true when a control point leaves the unit square", () => {
    expect(overshoots({ x1: 0.2, y1: 1.6, x2: 0.8, y2: 1 })).toBe(true);
    expect(overshoots({ x1: 0.2, y1: -0.4, x2: 0.8, y2: 1 })).toBe(true);
  });
});
