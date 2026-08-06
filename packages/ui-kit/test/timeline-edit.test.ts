import { describe, expect, it } from "vitest";
import type { Sequence, TimelineClip, Track } from "@director/project-schema";
import {
  collectSnapTargets,
  snapClipStart,
  planRippleDelete,
  planRippleTrim,
  type SnapTarget,
} from "../src/timeline-edit.js";

/**
 * Timeline editing gestures resolved to plain arithmetic.
 *
 * Snapping and rippling are the two places an editor silently loses frames: a
 * clip that lands one microsecond short of its neighbour leaves a gap nobody
 * can see at zoom level 1, and a ripple that shifts the wrong clips corrupts a
 * cut. Both are pure functions here so they can be pinned exactly, and so the
 * UI never invents timeline positions of its own.
 */

const clip = (
  id: string,
  trackId: string,
  startUs: string,
  durationUs: string,
): TimelineClip => ({
  id,
  assetId: `asset-${id}`,
  trackId,
  timelineStartUs: startUs,
  timelineDurationUs: durationUs,
  sourceInUs: "0",
  sourceOutUs: durationUs,
  playbackRate: { numerator: 1, denominator: 1 },
  audioGainDb: 0,
  audioPan: 0,
  effects: [],
});

const track = (id: string, clips: TimelineClip[]): Track => ({
  id,
  kind: "video",
  name: id,
  index: 0,
  clips,
});

const sequence = (tracks: Track[]): Sequence => ({
  id: "sequence-1",
  name: "Main",
  width: 1920,
  height: 1080,
  frameRate: { numerator: 30, denominator: 1 },
  tracks,
});

describe("collectSnapTargets", () => {
  it("offers the origin, the playhead and every other clip edge", () => {
    const seq = sequence([
      track("v1", [clip("a", "v1", "0", "2000000")]),
      track("v2", [clip("b", "v2", "5000000", "1000000")]),
    ]);
    const targets = collectSnapTargets(seq, ["dragged"], "3500000");
    const times = targets.map((t) => t.timeUs);
    expect(times).toContain("0"); // origin
    expect(times).toContain("3500000"); // playhead
    expect(times).toContain("2000000"); // end of a
    expect(times).toContain("5000000"); // start of b
    expect(times).toContain("6000000"); // end of b
  });

  it("excludes the clips being dragged, so a clip cannot snap to itself", () => {
    const seq = sequence([
      track("v1", [clip("a", "v1", "4000000", "1000000")]),
    ]);
    const times = collectSnapTargets(seq, ["a"], "0").map((t) => t.timeUs);
    expect(times).not.toContain("4000000");
    expect(times).not.toContain("5000000");
  });

  it("labels what each target is, so the UI can explain the snap", () => {
    const seq = sequence([
      track("v1", [clip("a", "v1", "1000000", "1000000")]),
    ]);
    const targets = collectSnapTargets(seq, [], "0");
    expect(targets.find((t) => t.timeUs === "1000000")?.kind).toBe(
      "clip-start",
    );
    expect(targets.find((t) => t.timeUs === "2000000")?.kind).toBe("clip-end");
  });
});

describe("snapClipStart", () => {
  const targets: SnapTarget[] = [
    { timeUs: "0", kind: "origin" },
    { timeUs: "2000000", kind: "clip-end" },
    { timeUs: "5000000", kind: "playhead" },
  ];

  it("leaves a position alone when nothing is within tolerance", () => {
    const result = snapClipStart("3000000", "1000000", targets, "100000");
    expect(result.startUs).toBe("3000000");
    expect(result.snappedTo).toBeNull();
  });

  it("snaps the clip start to a nearby target", () => {
    const result = snapClipStart("2050000", "1000000", targets, "100000");
    expect(result.startUs).toBe("2000000");
    expect(result.snappedTo?.kind).toBe("clip-end");
  });

  it("snaps the clip end to a nearby target, moving the start with it", () => {
    // A 1s clip dropped so that its tail lands just past the playhead: the tail
    // is what the editor is aiming at, so that is what should snap.
    const result = snapClipStart("4040000", "1000000", targets, "100000");
    expect(result.startUs).toBe("4000000");
    expect(result.snappedTo?.kind).toBe("playhead");
  });

  it("prefers the nearest target when two are in range", () => {
    const close: SnapTarget[] = [
      { timeUs: "1000000", kind: "clip-end" },
      { timeUs: "1090000", kind: "playhead" },
    ];
    expect(
      snapClipStart("1080000", "500000", close, "100000").snappedTo?.kind,
    ).toBe("playhead");
  });

  it("never snaps to a negative start", () => {
    const result = snapClipStart("10000", "1000000", targets, "100000");
    expect(BigInt(result.startUs)).toBeGreaterThanOrEqual(0n);
  });

  it("is a no-op at zero tolerance", () => {
    const result = snapClipStart("2000001", "1000000", targets, "0");
    expect(result.startUs).toBe("2000001");
  });
});

describe("planRippleDelete", () => {
  it("closes the gap by pulling every later clip back", () => {
    const t = track("v1", [
      clip("a", "v1", "0", "2000000"),
      clip("b", "v1", "2000000", "3000000"),
      clip("c", "v1", "5000000", "1000000"),
    ]);
    const plan = planRippleDelete(t, "b");
    expect(plan.deleteClipId).toBe("b");
    expect(plan.moves).toEqual([{ clipId: "c", timelineStartUs: "2000000" }]);
  });

  it("leaves earlier clips untouched", () => {
    const t = track("v1", [
      clip("a", "v1", "0", "2000000"),
      clip("b", "v1", "4000000", "1000000"),
    ]);
    expect(planRippleDelete(t, "b").moves).toEqual([]);
  });

  it("preserves the gaps between the clips it shifts", () => {
    // Rippling closes the deleted clip's own span, not every gap on the track.
    const t = track("v1", [
      clip("a", "v1", "0", "1000000"),
      clip("b", "v1", "3000000", "1000000"),
      clip("c", "v1", "6000000", "1000000"),
    ]);
    const plan = planRippleDelete(t, "a");
    expect(plan.moves).toEqual([
      { clipId: "b", timelineStartUs: "2000000" },
      { clipId: "c", timelineStartUs: "5000000" },
    ]);
  });

  it("returns nothing to move when the clip is not on the track", () => {
    const t = track("v1", [clip("a", "v1", "0", "1000000")]);
    expect(planRippleDelete(t, "missing").moves).toEqual([]);
  });

  it("orders the moves left to right, so no move ever collides", () => {
    // Applied as separate commands, an out-of-order shift would land a clip on
    // top of one that has not moved yet and be rejected as an overlap.
    const t = track("v1", [
      clip("a", "v1", "0", "1000000"),
      clip("b", "v1", "1000000", "1000000"),
      clip("c", "v1", "2000000", "1000000"),
      clip("d", "v1", "3000000", "1000000"),
    ]);
    const plan = planRippleDelete(t, "a");
    expect(plan.moves.map((m) => m.clipId)).toEqual(["b", "c", "d"]);
    const starts = plan.moves.map((m) => BigInt(m.timelineStartUs));
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]!).toBeGreaterThan(starts[i - 1]!);
    }
  });
});

describe("planRippleTrim", () => {
  it("pulls later clips back when a clip is shortened", () => {
    const t = track("v1", [
      clip("a", "v1", "0", "4000000"),
      clip("b", "v1", "4000000", "1000000"),
    ]);
    const plan = planRippleTrim(t, "a", "3000000");
    expect(plan.moves).toEqual([{ clipId: "b", timelineStartUs: "3000000" }]);
  });

  it("pushes later clips out when a clip is lengthened", () => {
    const t = track("v1", [
      clip("a", "v1", "0", "2000000"),
      clip("b", "v1", "2000000", "1000000"),
    ]);
    const plan = planRippleTrim(t, "a", "3000000");
    expect(plan.moves).toEqual([{ clipId: "b", timelineStartUs: "3000000" }]);
  });

  it("orders lengthening moves right to left so nothing collides mid-apply", () => {
    const t = track("v1", [
      clip("a", "v1", "0", "1000000"),
      clip("b", "v1", "1000000", "1000000"),
      clip("c", "v1", "2000000", "1000000"),
    ]);
    const plan = planRippleTrim(t, "a", "2000000");
    expect(plan.moves.map((m) => m.clipId)).toEqual(["c", "b"]);
  });

  it("does nothing when the duration is unchanged", () => {
    const t = track("v1", [
      clip("a", "v1", "0", "2000000"),
      clip("b", "v1", "2000000", "1000000"),
    ]);
    expect(planRippleTrim(t, "a", "2000000").moves).toEqual([]);
  });

  it("never plans a negative start", () => {
    const t = track("v1", [
      clip("a", "v1", "0", "1000000"),
      clip("b", "v1", "1000000", "1000000"),
    ]);
    const plan = planRippleTrim(t, "a", "0");
    for (const move of plan.moves) {
      expect(BigInt(move.timelineStartUs)).toBeGreaterThanOrEqual(0n);
    }
  });
});
