import { describe, expect, it } from "vitest";
import type { Sequence, Transition } from "@director/project-schema";
import { resolveAtTime } from "../src/index.js";
import { clip } from "./fixtures.js";

const CROSS: Transition = {
  id: "x1",
  kind: "cross",
  durationUs: "200000",
  easing: "linear",
};

/**
 * clip-a [0, 1_000_000) and clip-b pulled back to start at 800_000, so the two
 * overlap by exactly the 200ms of clip-b's incoming crossfade:
 *
 *   a  |==================|
 *   b                 |==================|
 *                     |<->|  200ms overlap
 */
function crossfadeSequence(): Sequence {
  const b = clip("clip-b", "track-1", "800000", "1000000", "500000");
  return {
    id: "sequence-1",
    name: "Main",
    width: 1920,
    height: 1080,
    frameRate: { numerator: 30, denominator: 1 },
    tracks: [
      {
        id: "track-1",
        kind: "video",
        name: "V1",
        index: 0,
        clips: [
          clip("clip-a", "track-1", "0", "1000000"),
          { ...b, transitionIn: CROSS },
        ],
      },
    ],
  };
}

describe("resolveAtTime during a same-track crossfade", () => {
  const seq = crossfadeSequence();

  it("returns only the outgoing clip before the overlap starts", () => {
    const at = resolveAtTime(seq, "799999");
    expect(at).toHaveLength(1);
    expect(at[0]?.clipId).toBe("clip-a");
  });

  it("returns both clips inside the overlap", () => {
    const at = resolveAtTime(seq, "900000");
    expect(at).toHaveLength(2);
    expect(at.map((l) => l.clipId).sort()).toEqual(["clip-a", "clip-b"]);
  });

  it("puts the incoming clip first so it paints on top", () => {
    // main.ts reverses the layer list before drawing, so index 0 is drawn last
    // — the clip fading in has to be the one on top of the one it replaces.
    const at = resolveAtTime(seq, "900000");
    expect(at[0]?.clipId).toBe("clip-b");
    expect(at[1]?.clipId).toBe("clip-a");
  });

  it("maps each clip's own source time inside the overlap", () => {
    const at = resolveAtTime(seq, "900000");
    const a = at.find((l) => l.clipId === "clip-a");
    const b = at.find((l) => l.clipId === "clip-b");
    // clip-a is 900ms into its own media...
    expect(a?.sourceTimeUs).toBe("900000");
    // ...while clip-b is only 100ms in, from a sourceIn of 500ms.
    expect(b?.sourceTimeUs).toBe("600000");
  });

  it("returns only the incoming clip once the outgoing one ends", () => {
    const at = resolveAtTime(seq, "1000000");
    expect(at).toHaveLength(1);
    expect(at[0]?.clipId).toBe("clip-b");
  });

  it("still returns a single clip when nothing overlaps", () => {
    const at = resolveAtTime(seq, "1500000");
    expect(at).toHaveLength(1);
    expect(at[0]?.clipId).toBe("clip-b");
  });

  it("orders deterministically when two clips share a start time", () => {
    const seqSameStart: Sequence = {
      ...crossfadeSequence(),
      tracks: [
        {
          id: "track-1",
          kind: "video",
          name: "V1",
          index: 0,
          clips: [
            clip("clip-z", "track-1", "0", "1000000"),
            {
              ...clip("clip-a", "track-1", "0", "1000000"),
              transitionIn: CROSS,
            },
          ],
        },
      ],
    };
    // Equal starts fall back to id order, so replay and export agree.
    const at = resolveAtTime(seqSameStart, "500000");
    expect(at.map((l) => l.clipId)).toEqual(["clip-a", "clip-z"]);
  });
});
