import { describe, expect, it } from "vitest";
import type { TimelineClip } from "@director/project-schema";
import { resolveClipDrag } from "../src/index.js";

const clip: TimelineClip = {
  id: "clip-1",
  assetId: "asset-1",
  trackId: "track-1",
  timelineStartUs: "1000000",
  timelineDurationUs: "1000000",
  sourceInUs: "500000",
  sourceOutUs: "1500000",
  playbackRate: { numerator: 1, denominator: 1 },
  audioGainDb: 0,
  audioPan: 0,
  effects: [],
};

describe("resolveClipDrag", () => {
  it("move: shifts timelineStartUs by the pixel delta (canonical us)", () => {
    const result = resolveClipDrag({
      kind: "move",
      sequenceId: "sequence-1",
      clip,
      targetTrackId: "track-2",
      deltaPixels: 120, // +1s at 120px/s
      pixelsPerSecond: 120,
    });
    expect(result).toEqual({
      commandType: "timeline.move_clip",
      payload: {
        sequenceId: "sequence-1",
        clipId: "clip-1",
        targetTrackId: "track-2",
        timelineStartUs: "2000000",
      },
    });
  });

  it("move: clamps negative start to 0", () => {
    const result = resolveClipDrag({
      kind: "move",
      sequenceId: "sequence-1",
      clip,
      deltaPixels: -1000,
      pixelsPerSecond: 120,
    });
    if (result.commandType === "timeline.move_clip") {
      expect(result.payload.timelineStartUs).toBe("0");
      expect(result.payload.targetTrackId).toBe("track-1"); // defaults to current
    }
  });

  it("trim-right: extends sourceOutUs, keeps sourceInUs", () => {
    const result = resolveClipDrag({
      kind: "trim-right",
      sequenceId: "sequence-1",
      clip,
      deltaPixels: 60, // +0.5s
      pixelsPerSecond: 120,
    });
    expect(result.commandType).toBe("timeline.trim_clip");
    if (result.commandType === "timeline.trim_clip") {
      expect(result.payload.sourceInUs).toBe("500000");
      expect(result.payload.sourceOutUs).toBe("2000000");
    }
  });

  it("trim-left: moves sourceInUs, never past the out-point", () => {
    const result = resolveClipDrag({
      kind: "trim-left",
      sequenceId: "sequence-1",
      clip,
      deltaPixels: 100000, // absurdly far right
      pixelsPerSecond: 120,
    });
    if (result.commandType === "timeline.trim_clip") {
      expect(BigInt(result.payload.sourceInUs)).toBeLessThan(
        BigInt(result.payload.sourceOutUs),
      );
    }
  });
});
