import { describe, expect, it } from "vitest";
import { normalizeTrack, packMagneticClips } from "../src/magnetic.js";
import { trackSchema } from "../src/entities.js";
import type { TimelineClip, Track } from "../src/entities.js";

/**
 * Magnetic tracks.
 *
 * One invariant does all the work: each clip starts where the previous ended.
 * Deleting closes the gap, inserting pushes, dragging past a neighbour
 * reorders — none of which needs a rule of its own.
 */

const clip = (id: string, startUs: string, durationUs: string): TimelineClip =>
  ({
    id,
    assetId: "asset-1",
    trackId: "track-1",
    timelineStartUs: startUs,
    timelineDurationUs: durationUs,
    sourceInUs: "0",
    sourceOutUs: durationUs,
    playbackRate: { numerator: 1, denominator: 1 },
    audioGainDb: 0,
    audioPan: 0,
    effects: [],
  }) as unknown as TimelineClip;

const track = (clips: TimelineClip[], magnetic?: boolean): Track =>
  ({
    id: "track-1",
    kind: "video",
    name: "V1",
    index: 0,
    ...(magnetic === undefined ? {} : { magnetic }),
    clips,
  }) as unknown as Track;

const layout = (clips: readonly TimelineClip[]) =>
  clips.map((c) => [c.id, c.timelineStartUs] as const);

describe("packMagneticClips", () => {
  it("closes a gap left by a removed clip", () => {
    const packed = packMagneticClips([
      clip("a", "0", "1000000"),
      clip("c", "3000000", "1000000"),
    ]);
    expect(layout(packed)).toEqual([
      ["a", "0"],
      ["c", "1000000"],
    ]);
  });

  it("pushes the rest along when something is inserted", () => {
    // The inserted clip sits between the two; packing moves the later one out
    // of the way rather than refusing the overlap.
    const packed = packMagneticClips([
      clip("a", "0", "1000000"),
      clip("new", "1000000", "500000"),
      clip("b", "1000000", "1000000"),
    ]);
    expect(layout(packed)).toEqual([
      ["a", "0"],
      ["new", "1000000"],
      ["b", "1500000"],
    ]);
  });

  it("reorders by where the clips were dragged to", () => {
    // Order comes from position, so a drag decides the order and the packing
    // decides the positions — which is what makes dragging past a neighbour
    // read as "reorder" rather than "overlap, then refuse".
    const packed = packMagneticClips([
      clip("a", "5000000", "1000000"),
      clip("b", "0", "2000000"),
    ]);
    expect(layout(packed)).toEqual([
      ["b", "0"],
      ["a", "2000000"],
    ]);
  });

  it("leaves an already-packed track exactly as it is", () => {
    const clips = [clip("a", "0", "1000000"), clip("b", "1000000", "500000")];
    expect(layout(packMagneticClips(clips))).toEqual(layout(clips));
  });

  it("never leaves a gap or an overlap, whatever it is given", () => {
    // The invariant, asserted directly rather than through examples.
    const packed = packMagneticClips([
      clip("a", "9000000", "1000000"),
      clip("b", "0", "250000"),
      clip("c", "9000000", "3000000"),
    ]);
    let expected = 0n;
    for (const c of packed) {
      expect(c.timelineStartUs).toBe(expected.toString());
      expected += BigInt(c.timelineDurationUs);
    }
  });

  it("handles an empty track", () => {
    expect(packMagneticClips([])).toEqual([]);
  });
});

describe("normalizeTrack", () => {
  it("leaves an ordinary track alone, gaps and all", () => {
    // The whole point of per-track: an unmarked track behaves exactly as it
    // always did, so lanes and everything built on them keep working.
    const ordinary = track([
      clip("a", "0", "1000000"),
      clip("b", "5000000", "1000000"),
    ]);
    expect(normalizeTrack(ordinary)).toBe(ordinary);
  });

  it("packs a magnetic one", () => {
    const magnetic = track(
      [clip("a", "0", "1000000"), clip("b", "5000000", "1000000")],
      true,
    );
    expect(layout(normalizeTrack(magnetic).clips)).toEqual([
      ["a", "0"],
      ["b", "1000000"],
    ]);
  });

  it("returns the same object when nothing moved", () => {
    // A no-op edit must not rewrite the project, or a byte-identical state
    // would look like a change to undo and to the save file.
    const settled = track(
      [clip("a", "0", "1000000"), clip("b", "1000000", "500000")],
      true,
    );
    expect(normalizeTrack(settled)).toBe(settled);
  });
});

describe("the schema", () => {
  it("accepts a track without the flag, and keeps it absent", () => {
    const parsed = trackSchema.parse({
      id: "track-1",
      kind: "video",
      name: "V1",
      index: 0,
      clips: [],
    });
    expect(parsed).not.toHaveProperty("magnetic");
  });

  it("accepts a magnetic one", () => {
    const parsed = trackSchema.parse({
      id: "track-1",
      kind: "video",
      name: "V1",
      index: 0,
      magnetic: true,
      clips: [],
    });
    expect(parsed.magnetic).toBe(true);
  });
});
