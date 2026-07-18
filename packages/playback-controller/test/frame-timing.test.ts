import { describe, expect, it } from "vitest";
import type { Rational } from "@director/project-schema";
import {
  frameToStartTimeUs,
  framesInDuration,
  timeToFrameIndex,
} from "../src/index.js";

const RATES: Array<[string, Rational]> = [
  ["24", { numerator: 24, denominator: 1 }],
  ["25", { numerator: 25, denominator: 1 }],
  ["30", { numerator: 30, denominator: 1 }],
  ["29.97 (30000/1001)", { numerator: 30000, denominator: 1001 }],
  ["23.976 (24000/1001)", { numerator: 24000, denominator: 1001 }],
];

describe("frame <-> time round trips", () => {
  it.each(RATES)(
    "frameToStartTimeUs then timeToFrameIndex is identity (%s)",
    (_label, rate) => {
      for (let frame = 0; frame < 500; frame++) {
        const t = frameToStartTimeUs(frame, rate);
        expect(timeToFrameIndex(t, rate)).toBe(frame);
      }
    },
  );

  it("frame 0 starts at 0", () => {
    for (const [, rate] of RATES) {
      expect(frameToStartTimeUs(0, rate)).toBe("0");
    }
  });

  it("frame start times are strictly increasing", () => {
    const rate = { numerator: 30000, denominator: 1001 };
    let prev = -1n;
    for (let frame = 0; frame < 100; frame++) {
      const t = BigInt(frameToStartTimeUs(frame, rate));
      expect(t > prev).toBe(true);
      prev = t;
    }
  });
});

describe("framesInDuration", () => {
  it("counts whole frames at 30 fps", () => {
    // 1 second = 30 frames (indices 0..29 fit, frame 30 starts at 1e6)
    expect(framesInDuration("1000000", { numerator: 30, denominator: 1 })).toBe(
      30,
    );
    expect(framesInDuration("999999", { numerator: 30, denominator: 1 })).toBe(
      29,
    );
  });
});

describe("input guards", () => {
  it("rejects a nonpositive rate", () => {
    expect(() =>
      timeToFrameIndex("0", { numerator: 0, denominator: 1 }),
    ).toThrow(RangeError);
  });

  it("rejects a negative frame index", () => {
    expect(() =>
      frameToStartTimeUs(-1, { numerator: 30, denominator: 1 }),
    ).toThrow(RangeError);
  });
});
