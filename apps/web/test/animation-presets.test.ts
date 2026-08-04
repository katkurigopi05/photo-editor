import { describe, expect, it } from "vitest";
import { animationTracksSchema } from "@director/project-schema";
import {
  ANIMATION_PRESETS,
  materializeAnimationPreset,
} from "../src/animation-presets.js";

function sequentialIds(): () => string {
  let index = 0;
  return () => `generated-${index++}`;
}

describe("materializeAnimationPreset", () => {
  it("builds a full-duration Ken Burns zoom", () => {
    const tracks = materializeAnimationPreset(
      "ken-burns-in",
      "2000000",
      sequentialIds(),
    );

    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.property).toBe("transform.scale");
    expect(tracks[0]?.keyframes.map(({ timeUs, value }) => ({ timeUs, value }))).toEqual([
      { timeUs: "0", value: 1 },
      { timeUs: "2000000", value: 1.18 },
    ]);
  });

  it("builds multi-property drift and a closed loop pulse", () => {
    const drift = materializeAnimationPreset("drift", "1000000", sequentialIds());
    expect(drift.map((track) => track.property)).toEqual([
      "transform.position_x",
      "transform.position_y",
      "transform.scale",
    ]);

    const pulse = materializeAnimationPreset(
      "loop-pulse",
      "1000000",
      sequentialIds(),
    );
    expect(pulse[0]?.keyframes.map(({ timeUs, value }) => ({ timeUs, value }))).toEqual([
      { timeUs: "0", value: 1 },
      { timeUs: "500000", value: 1.12 },
      { timeUs: "1000000", value: 1 },
    ]);
  });

  it("deduplicates fractional keyframe times for extremely short clips", () => {
    const tracks = materializeAnimationPreset("pop", "1", sequentialIds());

    expect(animationTracksSchema.safeParse(tracks).success).toBe(true);
    expect(tracks[0]?.keyframes.map((keyframe) => keyframe.timeUs)).toEqual([
      "0",
      "1",
    ]);
  });

  it("publishes every requested Auto preset and rejects invalid duration", () => {
    expect(ANIMATION_PRESETS.map((preset) => preset.id)).toEqual([
      "ken-burns-in",
      "ken-burns-out",
      "pan-left",
      "pan-right",
      "fade-in",
      "fade-out",
      "pop",
      "drift",
      "loop-pulse",
    ]);
    expect(() =>
      materializeAnimationPreset("fade-in", "01", sequentialIds()),
    ).toThrow(RangeError);
  });
});
