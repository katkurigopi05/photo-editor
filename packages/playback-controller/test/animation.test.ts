import { describe, expect, it } from "vitest";
import { canonicalStringify } from "@director/canonical-json";
import type { AnimationTrack } from "@director/project-schema";
import {
  applyAnimationEasing,
  sampleAnimationTrack,
  sampleClipAnimations,
} from "../src/index.js";

const track: AnimationTrack = {
  id: "animation-scale",
  property: "transform.scale",
  keyframes: [
    { id: "a", timeUs: "0", value: 1, easing: "linear" },
    { id: "b", timeUs: "1000000", value: 2, easing: "ease-in-out" },
    { id: "c", timeUs: "2000000", value: 4, easing: "linear" },
  ],
};

describe("sampleAnimationTrack", () => {
  it("returns endpoint values before, at, and after the keyframe range", () => {
    expect(sampleAnimationTrack(track, "0")).toBe(1);
    expect(sampleAnimationTrack(track, "1000000")).toBe(2);
    expect(sampleAnimationTrack(track, "2000000")).toBe(4);
    expect(sampleAnimationTrack(track, "3000000")).toBe(4);
  });

  it("interpolates linearly using the left keyframe easing", () => {
    expect(sampleAnimationTrack(track, "250000")).toBeCloseTo(1.25, 9);
    expect(sampleAnimationTrack(track, "500000")).toBeCloseTo(1.5, 9);
    expect(sampleAnimationTrack(track, "750000")).toBeCloseTo(1.75, 9);
  });

  it("holds the left value until the next keyframe boundary", () => {
    const holdTrack: AnimationTrack = {
      ...track,
      keyframes: [
        { id: "a", timeUs: "0", value: 10, easing: "hold" },
        { id: "b", timeUs: "1000000", value: 20, easing: "linear" },
      ],
    };

    expect(sampleAnimationTrack(holdTrack, "999999")).toBe(10);
    expect(sampleAnimationTrack(holdTrack, "1000000")).toBe(20);
  });

  it("keeps precision when canonical times exceed Number safe integers", () => {
    const hugeTrack: AnimationTrack = {
      ...track,
      keyframes: [
        {
          id: "a",
          timeUs: "900719925474099300000",
          value: 0,
          easing: "linear",
        },
        {
          id: "b",
          timeUs: "900719925474099301000",
          value: 10,
          easing: "linear",
        },
      ],
    };

    expect(sampleAnimationTrack(hugeTrack, "900719925474099300500")).toBe(5);
  });

  it("does not mutate the caller-owned track", () => {
    const before = canonicalStringify(track);

    sampleAnimationTrack(track, "500000");

    expect(canonicalStringify(track)).toBe(before);
  });

  it("rejects invalid local times and an impossible empty track", () => {
    expect(() => sampleAnimationTrack(track, "01")).toThrow(RangeError);
    expect(() => sampleAnimationTrack(track, "-1")).toThrow(RangeError);
    expect(() =>
      sampleAnimationTrack({ ...track, keyframes: [] }, "0"),
    ).toThrow(RangeError);
  });
});

describe("applyAnimationEasing", () => {
  it("implements linear and hold easing", () => {
    expect(applyAnimationEasing("linear", 0.25)).toBe(0.25);
    expect(applyAnimationEasing("hold", 0.999)).toBe(0);
    expect(applyAnimationEasing("hold", 1)).toBe(1);
  });

  it("implements monotonic ease-in, ease-out, and ease-in-out curves", () => {
    const easeIn = applyAnimationEasing("ease-in", 0.5);
    const easeOut = applyAnimationEasing("ease-out", 0.5);
    const easeInOut = applyAnimationEasing("ease-in-out", 0.5);

    expect(easeIn).toBeGreaterThan(0);
    expect(easeIn).toBeLessThan(0.5);
    expect(easeOut).toBeGreaterThan(0.5);
    expect(easeOut).toBeLessThan(1);
    expect(easeInOut).toBeCloseTo(0.5, 6);
  });

  it("clamps progress to the animation interval", () => {
    expect(applyAnimationEasing("linear", -1)).toBe(0);
    expect(applyAnimationEasing("linear", 2)).toBe(1);
  });
});

describe("sampleClipAnimations", () => {
  it("samples every property and returns an empty object without tracks", () => {
    const opacityTrack: AnimationTrack = {
      id: "animation-opacity",
      property: "transform.opacity",
      keyframes: [
        { id: "a", timeUs: "0", value: 0, easing: "linear" },
        { id: "b", timeUs: "1000000", value: 1, easing: "linear" },
      ],
    };

    expect(
      sampleClipAnimations({ animations: [track, opacityTrack] }, "500000"),
    ).toEqual({ "transform.scale": 1.5, "transform.opacity": 0.5 });
    expect(sampleClipAnimations({}, "500000")).toEqual({});
  });
});
