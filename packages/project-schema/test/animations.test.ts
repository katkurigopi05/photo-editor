import { describe, expect, it } from "vitest";
import { timelineClipSchema } from "../src/index.js";

const baseClip = {
  id: "clip-1",
  assetId: "asset-1",
  trackId: "track-1",
  timelineStartUs: "0",
  timelineDurationUs: "3000000",
  sourceInUs: "0",
  sourceOutUs: "3000000",
  playbackRate: { numerator: 1, denominator: 1 },
  audioGainDb: 0,
  audioPan: 0,
  effects: [],
};

const validTrack = {
  id: "animation-1",
  property: "transform.scale",
  keyframes: [
    { id: "keyframe-1", timeUs: "0", value: 1, easing: "ease-in-out" },
    {
      id: "keyframe-2",
      timeUs: "3000000",
      value: 1.25,
      easing: "ease-in-out",
    },
  ],
};

describe("timeline clip animations", () => {
  it("accepts a strict, ordered animation track", () => {
    const result = timelineClipSchema.safeParse({
      ...baseClip,
      animations: [validTrack],
    });

    expect(result.success).toBe(true);
  });

  it("keeps existing projects valid without injecting new state", () => {
    const result = timelineClipSchema.parse(baseClip);

    expect(result).not.toHaveProperty("animations");
  });

  it.each([
    ["unknown property", { ...validTrack, property: "transform.skew" }],
    [
      "unknown easing",
      {
        ...validTrack,
        keyframes: [{ ...validTrack.keyframes[0], easing: "spring" }],
      },
    ],
    [
      "out-of-range opacity",
      {
        ...validTrack,
        property: "transform.opacity",
        keyframes: [{ ...validTrack.keyframes[0], value: 1.01 }],
      },
    ],
    [
      "non-finite value",
      {
        ...validTrack,
        keyframes: [{ ...validTrack.keyframes[0], value: Number.NaN }],
      },
    ],
    [
      "non-canonical time",
      {
        ...validTrack,
        keyframes: [{ ...validTrack.keyframes[0], timeUs: "01" }],
      },
    ],
    [
      "unknown key",
      {
        ...validTrack,
        keyframes: [{ ...validTrack.keyframes[0], extra: true }],
      },
    ],
  ])("rejects %s", (_name, track) => {
    expect(
      timelineClipSchema.safeParse({ ...baseClip, animations: [track] })
        .success,
    ).toBe(false);
  });

  it("requires keyframes to be strictly ordered with unique times", () => {
    const reversed = {
      ...validTrack,
      keyframes: [...validTrack.keyframes].reverse(),
    };
    const duplicateTime = {
      ...validTrack,
      keyframes: [
        validTrack.keyframes[0],
        { ...validTrack.keyframes[1], timeUs: "0" },
      ],
    };

    expect(
      timelineClipSchema.safeParse({ ...baseClip, animations: [reversed] })
        .success,
    ).toBe(false);
    expect(
      timelineClipSchema.safeParse({ ...baseClip, animations: [duplicateTime] })
        .success,
    ).toBe(false);
  });

  it("rejects duplicate track properties and identifiers", () => {
    const secondTrack = {
      ...validTrack,
      id: "animation-2",
      keyframes: validTrack.keyframes.map((keyframe, index) => ({
        ...keyframe,
        id: `other-${index}`,
      })),
    };
    const duplicateId = {
      ...secondTrack,
      property: "transform.position_x",
      id: validTrack.id,
    };

    expect(
      timelineClipSchema.safeParse({
        ...baseClip,
        animations: [validTrack, secondTrack],
      }).success,
    ).toBe(false);
    expect(
      timelineClipSchema.safeParse({
        ...baseClip,
        animations: [validTrack, duplicateId],
      }).success,
    ).toBe(false);
  });
});
