import { describe, expect, it } from "vitest";
import {
  clipPlaybackRateSchema,
  unitPlaybackRateSchema,
} from "../src/primitives.js";
import { timelineClipSchema } from "../src/entities.js";

/**
 * Variable clip speed.
 *
 * The rate is a rational, not a float: at 1/3 speed a float would make every
 * source-time computation in the timeline irrational-ish and non-reproducible,
 * while `sourceIn + offset * num / den` in BigInt is exact. That only works if
 * the schema keeps the rate in one canonical form, so unreduced equivalents are
 * refused — 2/2 and 1/1 must not be two spellings of the same project.
 */

const clip = (rate: unknown): unknown => ({
  id: "clip-1",
  assetId: "asset-1",
  trackId: "track-1",
  timelineStartUs: "0",
  timelineDurationUs: "1000000",
  sourceInUs: "0",
  sourceOutUs: "1000000",
  playbackRate: rate,
  audioGainDb: 0,
  audioPan: 0,
  effects: [],
});

describe("clipPlaybackRateSchema", () => {
  it("accepts normal speed", () => {
    expect(
      clipPlaybackRateSchema.parse({ numerator: 1, denominator: 1 }),
    ).toEqual({ numerator: 1, denominator: 1 });
  });

  it("accepts speeds between quarter and quadruple", () => {
    for (const rate of [
      { numerator: 1, denominator: 4 },
      { numerator: 1, denominator: 2 },
      { numerator: 3, denominator: 2 },
      { numerator: 2, denominator: 1 },
      { numerator: 4, denominator: 1 },
    ]) {
      expect(clipPlaybackRateSchema.safeParse(rate).success).toBe(true);
    }
  });

  it("rejects speeds outside the supported range", () => {
    // Beyond 4x the decoder is asked for frames faster than it can supply them
    // and below 0.25x every source frame is held for so long that the result is
    // a slideshow — both are better refused than silently poor.
    expect(
      clipPlaybackRateSchema.safeParse({ numerator: 5, denominator: 1 })
        .success,
    ).toBe(false);
    expect(
      clipPlaybackRateSchema.safeParse({ numerator: 1, denominator: 5 })
        .success,
    ).toBe(false);
  });

  it("rejects unreduced rates, so one speed has one spelling", () => {
    expect(
      clipPlaybackRateSchema.safeParse({ numerator: 2, denominator: 2 })
        .success,
    ).toBe(false);
    expect(
      clipPlaybackRateSchema.safeParse({ numerator: 4, denominator: 2 })
        .success,
    ).toBe(false);
  });

  it("rejects zero and negative components", () => {
    expect(
      clipPlaybackRateSchema.safeParse({ numerator: 0, denominator: 1 })
        .success,
    ).toBe(false);
    expect(
      clipPlaybackRateSchema.safeParse({ numerator: -1, denominator: 1 })
        .success,
    ).toBe(false);
  });

  it("still accepts everything the unit-rate schema accepted", () => {
    // Projects written before variable speed carry exactly 1/1 and must parse
    // byte-for-byte identically.
    const unit = unitPlaybackRateSchema.parse({
      numerator: 1,
      denominator: 1,
    });
    expect(clipPlaybackRateSchema.parse(unit)).toEqual(unit);
  });
});

describe("timelineClipSchema with a rate", () => {
  it("accepts a clip at double speed", () => {
    expect(
      timelineClipSchema.safeParse(clip({ numerator: 2, denominator: 1 }))
        .success,
    ).toBe(true);
  });

  it("rejects a clip at an unsupported rate", () => {
    expect(
      timelineClipSchema.safeParse(clip({ numerator: 9, denominator: 1 }))
        .success,
    ).toBe(false);
  });
});
