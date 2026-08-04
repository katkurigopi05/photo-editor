import { describe, expect, it } from "vitest";
import type { TimelineClip } from "@director/project-schema";
import {
  adjacentKeyframeTime,
  animationValueAtTime,
  clipLocalTimeForPlayhead,
  exactKeyframeAtTime,
  keyframePositionPercent,
  uniqueKeyframeTimes,
} from "../src/keyframe-ui.js";

const clip = {
  timelineStartUs: "1000000",
  timelineDurationUs: "2000000",
  animations: [
    {
      id: "scale",
      property: "transform.scale",
      keyframes: [
        { id: "a", timeUs: "0", value: 1, easing: "linear" },
        { id: "b", timeUs: "1000000", value: 2, easing: "linear" },
      ],
    },
    {
      id: "opacity",
      property: "transform.opacity",
      keyframes: [
        { id: "c", timeUs: "1000000", value: 0.5, easing: "hold" },
        { id: "d", timeUs: "2000000", value: 1, easing: "linear" },
      ],
    },
  ],
} as Pick<
  TimelineClip,
  "timelineStartUs" | "timelineDurationUs" | "animations"
>;

describe("clipLocalTimeForPlayhead", () => {
  it("converts absolute time and clamps outside the clip", () => {
    expect(clipLocalTimeForPlayhead(clip, "500000")).toBe("0");
    expect(clipLocalTimeForPlayhead(clip, "1500000")).toBe("500000");
    expect(clipLocalTimeForPlayhead(clip, "4000000")).toBe("2000000");
  });

  it("positions timeline markers without Number precision loss", () => {
    expect(
      keyframePositionPercent(
        "450359962737049650000",
        "900719925474099300000",
      ),
    ).toBe(50);
  });
});

describe("animation inspector state", () => {
  it("samples existing tracks and returns property defaults otherwise", () => {
    expect(animationValueAtTime(clip, "transform.scale", "500000")).toBe(1.5);
    expect(animationValueAtTime(clip, "transform.position_x", "500000")).toBe(0);
  });

  it("finds only a keyframe exactly under the playhead", () => {
    expect(exactKeyframeAtTime(clip, "transform.scale", "1000000")?.id).toBe(
      "b",
    );
    expect(exactKeyframeAtTime(clip, "transform.scale", "500000")).toBeUndefined();
  });

  it("collects sorted unique times and resolves previous/next navigation", () => {
    const times = uniqueKeyframeTimes(clip);
    expect(times).toEqual(["0", "1000000", "2000000"]);
    expect(adjacentKeyframeTime(times, "1000000", -1)).toBe("0");
    expect(adjacentKeyframeTime(times, "1000000", 1)).toBe("2000000");
    expect(adjacentKeyframeTime(times, "2000000", 1)).toBeUndefined();
  });
});
