import { describe, expect, it } from "vitest";
import {
  createPlaybackState,
  pause,
  play,
  seek,
  setLoopRegion,
  setRate,
  tick,
} from "../src/index.js";

const DURATION = "2000000";

describe("transport basics", () => {
  it("starts paused at 0", () => {
    const s = createPlaybackState(DURATION);
    expect(s.currentTimeUs).toBe("0");
    expect(s.playing).toBe(false);
  });

  it("play/pause toggle without mutating input", () => {
    const s = createPlaybackState(DURATION);
    const p = play(s);
    expect(p.playing).toBe(true);
    expect(s.playing).toBe(false); // original untouched
    expect(pause(p).playing).toBe(false);
  });

  it("seek clamps to [0, duration]", () => {
    const s = createPlaybackState(DURATION);
    expect(seek(s, "500000").currentTimeUs).toBe("500000");
    expect(seek(s, "-1").currentTimeUs).toBe("0");
    expect(seek(s, "9999999").currentTimeUs).toBe("2000000");
  });
});

describe("tick", () => {
  it("is a no-op when paused", () => {
    const s = createPlaybackState(DURATION);
    expect(tick(s, "100000")).toBe(s);
  });

  it("advances by the delta at rate 1/1", () => {
    const s = play(createPlaybackState(DURATION));
    expect(tick(s, "333333").currentTimeUs).toBe("333333");
  });

  it("applies a rate multiplier exactly", () => {
    const s = setRate(play(createPlaybackState(DURATION)), {
      numerator: 2,
      denominator: 1,
    });
    expect(tick(s, "100000").currentTimeUs).toBe("200000"); // 2x speed
  });

  it("stops (pauses) at the duration when not looping", () => {
    const s = seek(play(createPlaybackState(DURATION)), "1900000");
    const next = tick(s, "500000");
    expect(next.currentTimeUs).toBe("2000000");
    expect(next.playing).toBe(false);
  });

  it("rejects a negative delta", () => {
    const s = play(createPlaybackState(DURATION));
    expect(() => tick(s, "-1")).toThrow(RangeError);
  });
});

describe("loop region", () => {
  it("wraps within the loop region", () => {
    let s = createPlaybackState(DURATION);
    s = setLoopRegion(s, { startUs: "1000000", endUs: "1500000" });
    s = seek(play(s), "1400000");
    // advance 200_000: 1_600_000 >= end(1_500_000) -> wrap to 1_000_000 + (600_000 % 500_000)
    expect(tick(s, "200000").currentTimeUs).toBe("1100000");
  });

  it("wraps exactly at the end back to the start", () => {
    let s = createPlaybackState(DURATION);
    s = setLoopRegion(s, { startUs: "1000000", endUs: "1500000" });
    s = seek(play(s), "1400000");
    expect(tick(s, "100000").currentTimeUs).toBe("1000000");
  });

  it("rejects an invalid loop region", () => {
    const s = createPlaybackState(DURATION);
    expect(() => setLoopRegion(s, { startUs: "5", endUs: "5" })).toThrow(
      RangeError,
    );
    expect(() => setLoopRegion(s, { startUs: "0", endUs: "9999999" })).toThrow(
      RangeError,
    );
  });

  it("clears the loop region with null", () => {
    let s = createPlaybackState(DURATION);
    s = setLoopRegion(s, { startUs: "0", endUs: "1000000" });
    expect(setLoopRegion(s, null).loopRegion).toBeNull();
  });
});
