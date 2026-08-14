import { describe, expect, it } from "vitest";
import {
  createPlaybackState,
  pause,
  play,
  seek,
  setLoopRegion,
  setDirection,
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

describe("direction", () => {
  /**
   * Reverse playback, as J/K/L shuttling needs it.
   *
   * Direction is separate from rate rather than a negative rate. `rate` is a
   * Rational the exact tick arithmetic divides by, and it is asserted positive
   * on the way in; making it signed would put a sign into every multiplication
   * and division that reads it. A magnitude and a direction keep that
   * arithmetic exactly as it was.
   */

  it("starts forward", () => {
    expect(createPlaybackState(DURATION).direction).toBe(1);
  });

  it("runs time backwards when reversed", () => {
    const s = setDirection(
      play(seek(createPlaybackState(DURATION), "1000000")),
      -1,
    );
    expect(tick(s, "250000").currentTimeUs).toBe("750000");
  });

  it("applies the rate to a reversed tick as well", () => {
    // A 2× reverse shuttle must cover twice the ground, not half.
    const s = setRate(
      setDirection(play(seek(createPlaybackState(DURATION), "1000000")), -1),
      { numerator: 2, denominator: 1 },
    );
    expect(tick(s, "250000").currentTimeUs).toBe("500000");
  });

  it("stops at zero rather than going negative", () => {
    // Time before the start of the sequence does not exist, and a negative
    // microsecond string would reach every consumer of currentTimeUs.
    const s = setDirection(
      play(seek(createPlaybackState(DURATION), "100000")),
      -1,
    );
    const out = tick(s, "500000");
    expect(out.currentTimeUs).toBe("0");
    expect(out.playing).toBe(false);
  });

  it("wraps to the end of a loop region when running backwards", () => {
    // Forward playback wraps start→end; reverse has to wrap end→start or a
    // loop becomes a one-way trip the moment you shuttle back through it.
    const s = setDirection(
      play(
        setLoopRegion(seek(createPlaybackState(DURATION), "1100000"), {
          startUs: "1000000",
          endUs: "1500000",
        }),
      ),
      -1,
    );
    expect(tick(s, "200000").currentTimeUs).toBe("1400000");
  });

  it("refuses a direction that is neither forward nor back", () => {
    expect(() =>
      setDirection(createPlaybackState(DURATION), 0 as 1 | -1),
    ).toThrow(RangeError);
  });

  it("does not mutate the state it is given", () => {
    const s = createPlaybackState(DURATION);
    setDirection(s, -1);
    expect(s.direction).toBe(1);
  });
});
