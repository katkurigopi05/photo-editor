import { describe, expect, it } from "vitest";
import type { AnimationTrack } from "@director/project-schema";
import {
  clipLocalTimeUs,
  composeCanvasLayerTransform,
  resolveLayerAnimationTransform,
} from "../src/layer-animation.js";

const animations: AnimationTrack[] = [
  {
    id: "position-x",
    property: "transform.position_x",
    keyframes: [
      { id: "x0", timeUs: "0", value: 0, easing: "linear" },
      { id: "x1", timeUs: "1000000", value: 0.5, easing: "linear" },
    ],
  },
  {
    id: "scale",
    property: "transform.scale",
    keyframes: [
      { id: "s0", timeUs: "0", value: 1, easing: "linear" },
      { id: "s1", timeUs: "1000000", value: 2, easing: "linear" },
    ],
  },
  {
    id: "rotation",
    property: "transform.rotation",
    keyframes: [
      { id: "r0", timeUs: "0", value: 0, easing: "linear" },
      { id: "r1", timeUs: "1000000", value: 90, easing: "linear" },
    ],
  },
  {
    id: "opacity",
    property: "transform.opacity",
    keyframes: [
      { id: "o0", timeUs: "0", value: 0, easing: "linear" },
      { id: "o1", timeUs: "1000000", value: 1, easing: "linear" },
    ],
  },
];

describe("resolveLayerAnimationTransform", () => {
  it("returns identity defaults when a clip has no animation tracks", () => {
    expect(resolveLayerAnimationTransform({}, "500000")).toEqual({
      positionX: 0,
      positionY: 0,
      scale: 1,
      rotationDegrees: 0,
      opacity: 1,
    });
  });

  it("samples authored properties while retaining missing-property defaults", () => {
    expect(resolveLayerAnimationTransform({ animations }, "500000")).toEqual({
      positionX: 0.25,
      positionY: 0,
      scale: 1.5,
      rotationDegrees: 45,
      opacity: 0.5,
    });
  });
});

describe("composeCanvasLayerTransform", () => {
  it("combines static effects, animation, flips, and normalized position", () => {
    const result = composeCanvasLayerTransform(
      { alpha: 0.8, rotateDeg: 10, flipX: true, flipY: false },
      {
        positionX: 0.1,
        positionY: -0.2,
        scale: 2,
        rotationDegrees: 20,
        opacity: 0.5,
      },
      1000,
      500,
    );

    expect(result).toEqual({
      offsetXPx: 100,
      offsetYPx: -100,
      scaleX: -2,
      scaleY: 2,
      rotationDegrees: 30,
      alpha: 0.4,
    });
  });
});

describe("clipLocalTimeUs", () => {
  it("subtracts with BigInt precision", () => {
    expect(
      clipLocalTimeUs("900719925474099301000", "900719925474099300000"),
    ).toBe("1000");
  });

  it("rejects timeline times before clip start", () => {
    expect(() => clipLocalTimeUs("99", "100")).toThrow(RangeError);
  });
});
