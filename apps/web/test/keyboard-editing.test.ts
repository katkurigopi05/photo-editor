import { describe, expect, it } from "vitest";
import {
  nextEditPoint,
  shuttleAfter,
  shuttleLabel,
  shuttleRate,
  steppedTime,
  STOPPED,
  trimToPlayhead,
  SHUTTLE_SPEEDS,
} from "../src/keyboard-editing.js";

/**
 * The decisions behind keyboard editing.
 *
 * Each of these is a rule an editor's fingers learn, so a wrong one is felt
 * rather than seen: a shuttle that jumps straight from reverse to 2× forward, a
 * cut-stepping key that sticks on the cut it is already on, a frame step that
 * occasionally moves two.
 */

describe("shuttleAfter", () => {
  it("starts playing forward on the first L", () => {
    expect(shuttleAfter(STOPPED, "L")).toEqual({
      playing: true,
      direction: 1,
      speed: 1,
    });
  });

  it("steps up the ladder on repeated presses", () => {
    let s = shuttleAfter(STOPPED, "L");
    const seen = [s.speed];
    for (let i = 0; i < 3; i += 1) {
      s = shuttleAfter(s, "L");
      seen.push(s.speed);
    }
    expect(seen).toEqual([...SHUTTLE_SPEEDS]);
  });

  it("stops at the top rather than wrapping round to 1×", () => {
    // Wrapping from 8× back to 1× while leaning on the key is indistinguishable
    // from the key having missed.
    let s = STOPPED;
    for (let i = 0; i < 10; i += 1) s = shuttleAfter(s, "L");
    expect(s.speed).toBe(SHUTTLE_SPEEDS.at(-1));
  });

  it("passes through a stop when reversing, not straight to 2×", () => {
    // The rule that makes the key usable: L while running backwards returns to
    // 1× forward, the way a shuttle wheel passes through the middle.
    const back = shuttleAfter(shuttleAfter(STOPPED, "J"), "J");
    expect(back).toEqual({ playing: true, direction: -1, speed: 2 });
    expect(shuttleAfter(back, "L")).toEqual({
      playing: true,
      direction: 1,
      speed: 1,
    });
  });

  it("K stops and resets the speed", () => {
    let s = STOPPED;
    for (let i = 0; i < 3; i += 1) s = shuttleAfter(s, "L");
    expect(shuttleAfter(s, "K")).toEqual(STOPPED);
  });

  it("J plays backwards", () => {
    expect(shuttleAfter(STOPPED, "J")).toEqual({
      playing: true,
      direction: -1,
      speed: 1,
    });
  });

  it("gives the transport an exact rational rate", () => {
    // Floats are not used anywhere else in the transport, and a playhead that
    // drifts by a rounding error every frame drifts visibly over a minute.
    expect(shuttleRate({ playing: true, direction: -1, speed: 4 })).toEqual({
      numerator: 4,
      denominator: 1,
    });
  });

  it("labels the shuttle only while it is running", () => {
    expect(shuttleLabel(STOPPED)).toBe("");
    expect(shuttleLabel({ playing: true, direction: 1, speed: 2 })).toBe("2×");
    expect(shuttleLabel({ playing: true, direction: -1, speed: 4 })).toBe(
      "◀ 4×",
    );
  });
});

describe("nextEditPoint", () => {
  const cuts = [0n, 1_000_000n, 2_500_000n, 4_000_000n];

  it("finds the next cut forward", () => {
    expect(nextEditPoint(cuts, 1_000_000n, 1)).toBe(2_500_000n);
  });

  it("finds the previous cut backwards", () => {
    expect(nextEditPoint(cuts, 2_500_000n, -1)).toBe(1_000_000n);
  });

  it("does not stick on the cut it is already on", () => {
    // Strictly past, or holding the key parks the playhead on one boundary.
    expect(nextEditPoint(cuts, 2_500_000n, 1)).toBe(4_000_000n);
  });

  it("returns null at the ends rather than wrapping", () => {
    // Arriving at the last cut and staying there is what an editor expects;
    // reappearing at the start is disorienting.
    expect(nextEditPoint(cuts, 4_000_000n, 1)).toBe(null);
    expect(nextEditPoint(cuts, 0n, -1)).toBe(null);
  });

  it("sorts points it is given out of order", () => {
    expect(nextEditPoint([4_000_000n, 0n, 1_000_000n], 0n, 1)).toBe(1_000_000n);
  });

  it("handles an empty timeline", () => {
    expect(nextEditPoint([], 0n, 1)).toBe(null);
  });
});

describe("steppedTime", () => {
  const FRAME = 41_667n; // 24fps, near enough
  const DURATION = 10_000_000n;

  it("moves one frame forward", () => {
    expect(steppedTime(FRAME * 10n, FRAME, 1, DURATION)).toBe(FRAME * 11n);
  });

  it("moves back a frame", () => {
    expect(steppedTime(FRAME * 10n, FRAME, -1, DURATION)).toBe(FRAME * 9n);
  });

  it("lands on the frame grid from a time between frames", () => {
    // Adding a frame duration to an off-grid time keeps it off-grid forever,
    // and the error shows up as a step that occasionally moves two frames.
    expect(steppedTime(FRAME * 10n + 900n, FRAME, 1, DURATION)).toBe(
      FRAME * 11n,
    );
  });

  it("clamps at zero and at the duration", () => {
    expect(steppedTime(0n, FRAME, -5, DURATION)).toBe(0n);
    expect(steppedTime(DURATION, FRAME, 5, DURATION)).toBe(DURATION);
  });

  it("does nothing when the frame duration is unknown", () => {
    expect(steppedTime(1234n, 0n, 1, DURATION)).toBe(1234n);
  });
});

describe("trimToPlayhead", () => {
  const clip = {
    sourceInUs: 500_000n,
    timelineStartUs: 1_000_000n,
    timelineDurationUs: 2_000_000n,
  };

  it("moves the head and pulls the source in-point with it", () => {
    // The frame under the playhead has to stay the frame under the playhead;
    // moving the start without the source scrubs the clip's content sideways.
    const out = trimToPlayhead(clip, 1_500_000n, "head");
    expect(out).toEqual({
      sourceInUs: 1_000_000n,
      timelineStartUs: 1_500_000n,
      timelineDurationUs: 1_500_000n,
    });
  });

  it("shortens the tail without touching the source in-point", () => {
    const out = trimToPlayhead(clip, 2_000_000n, "tail");
    expect(out).toEqual({
      sourceInUs: 500_000n,
      timelineStartUs: 1_000_000n,
      timelineDurationUs: 1_000_000n,
    });
  });

  it("refuses a playhead outside the clip", () => {
    expect(trimToPlayhead(clip, 500_000n, "head")).toBe(null);
    expect(trimToPlayhead(clip, 4_000_000n, "tail")).toBe(null);
  });

  it("refuses a trim that would leave nothing", () => {
    // A zero-length clip looks like the clip vanished, which reads as a bug
    // rather than as the trim the user asked for.
    expect(trimToPlayhead(clip, 1_000_000n, "head")).toBe(null);
    expect(trimToPlayhead(clip, 3_000_000n, "tail")).toBe(null);
  });

  it("keeps the clip's total source span consistent", () => {
    // Trimming the head by n must advance the source by exactly n, or the clip
    // plays different content than it did before the trim.
    const out = trimToPlayhead(clip, 1_750_000n, "head")!;
    expect(out.sourceInUs - clip.sourceInUs).toBe(
      out.timelineStartUs - clip.timelineStartUs,
    );
    expect(out.timelineDurationUs).toBe(
      clip.timelineDurationUs - (out.timelineStartUs - clip.timelineStartUs),
    );
  });
});
