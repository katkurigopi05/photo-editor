import { describe, expect, it } from "vitest";
import {
  rampSpans,
  rampTimelineDurationUs,
  rateAtClipOffset,
  sourceAtClipOffset,
  speedRampSchema,
  type SpeedRamp,
} from "../src/speed-ramp.js";
import { timelineClipSchema } from "../src/entities.js";

/**
 * Speed ramps: a clip whose rate changes partway through.
 *
 * Stepped rather than smooth, and that is the whole design. A continuously
 * interpolated rate makes source position the *integral* of the rate, so
 * resolving a timeline instant back to a source instant means solving a
 * quadratic — irrational, and the engine's promise is that the same clip
 * resolves to the same source microsecond on every machine. Constant rational
 * rates between boundaries keep every step exact BigInt arithmetic, in both
 * directions.
 *
 * Segments are anchored in **source** time, not timeline time. Source offsets
 * do not move when a rate changes; timeline offsets all shift, so anchoring
 * there would mean rewriting every later segment on every edit.
 */

const seg = (id: string, sourceOffsetUs: string, num: number, den: number) => ({
  id,
  sourceOffsetUs,
  rate: { numerator: num, denominator: den },
});

/** Normal, then quarter speed from 2s, then normal again from 3s. */
const ramp: SpeedRamp = [
  seg("s1", "0", 1, 1),
  seg("s2", "2000000", 1, 4),
  seg("s3", "3000000", 1, 1),
];

const clip = (overrides: Record<string, unknown> = {}) =>
  timelineClipSchema.parse({
    id: "clip-1",
    assetId: "asset-1",
    trackId: "track-1",
    timelineStartUs: "0",
    timelineDurationUs: "5000000",
    sourceInUs: "0",
    sourceOutUs: "5000000",
    playbackRate: { numerator: 1, denominator: 1 },
    audioGainDb: 0,
    audioPan: 0,
    effects: [],
    ...overrides,
  });

describe("speedRampSchema", () => {
  it("accepts a ramp that starts at the clip's own source in-point", () => {
    expect(speedRampSchema.parse(ramp)).toHaveLength(3);
  });

  it("rejects a ramp that does not start at zero", () => {
    // The first segment has to describe the clip's first frame, or the span
    // before it would have no rate at all.
    expect(
      speedRampSchema.safeParse([
        seg("s1", "1000000", 1, 1),
        seg("s2", "2000000", 1, 4),
      ]).success,
    ).toBe(false);
  });

  it("rejects offsets that do not strictly increase", () => {
    expect(
      speedRampSchema.safeParse([seg("s1", "0", 1, 1), seg("s2", "0", 1, 4)])
        .success,
    ).toBe(false);
    expect(
      speedRampSchema.safeParse([
        seg("s1", "0", 1, 1),
        seg("s2", "3000000", 1, 4),
        seg("s3", "2000000", 1, 1),
      ]).success,
    ).toBe(false);
  });

  it("rejects duplicate segment ids", () => {
    expect(
      speedRampSchema.safeParse([
        seg("s1", "0", 1, 1),
        seg("s1", "2000000", 1, 4),
      ]).success,
    ).toBe(false);
  });

  it("rejects a single-segment ramp", () => {
    // One rate for the whole clip is `playbackRate`, and it already has a
    // spelling. Two ways to say the same thing would be two byte-different
    // projects that render identically.
    expect(speedRampSchema.safeParse([seg("s1", "0", 1, 2)]).success).toBe(
      false,
    );
  });

  it("rejects a rate the constant-speed schema would also reject", () => {
    // Same bounds and the same lowest-terms rule: 2/2 is refused rather than
    // reduced, and 8x is out of range.
    expect(
      speedRampSchema.safeParse([
        seg("s1", "0", 2, 2),
        seg("s2", "1000000", 1, 4),
      ]).success,
    ).toBe(false);
    expect(
      speedRampSchema.safeParse([
        seg("s1", "0", 8, 1),
        seg("s2", "1000000", 1, 4),
      ]).success,
    ).toBe(false);
  });

  it("is absent on a clip nobody has ramped", () => {
    expect(clip()).not.toHaveProperty("speedRamp");
  });

  it("rides on a clip when present", () => {
    expect(clip({ speedRamp: ramp }).speedRamp).toHaveLength(3);
  });
});

describe("rampTimelineDurationUs", () => {
  it("sums each segment's own stretch", () => {
    // 0–2s at 1x is 2s; 2–3s at quarter speed is 4s; 3–5s at 1x is 2s.
    expect(rampTimelineDurationUs(ramp, "0", "5000000")).toBe("8000000");
  });

  it("matches the constant-rate formula when every segment shares a rate", () => {
    const flat: SpeedRamp = [seg("a", "0", 1, 2), seg("b", "2000000", 1, 2)];
    // 5s of source at half speed is 10s of timeline, however it is cut up.
    expect(rampTimelineDurationUs(flat, "0", "5000000")).toBe("10000000");
  });

  it("measures from the clip's own in-point", () => {
    // Offsets are relative to sourceInUs, so a trimmed clip ramps the same way.
    expect(rampTimelineDurationUs(ramp, "1000000", "6000000")).toBe("8000000");
  });
});

describe("sourceAtClipOffset", () => {
  const ramped = clip({ speedRamp: ramp, timelineDurationUs: "8000000" });

  it("maps a timeline offset back to an exact source instant", () => {
    // Inside the first, full-speed segment.
    expect(sourceAtClipOffset(ramped, 0n)).toBe(0n);
    expect(sourceAtClipOffset(ramped, 1_000_000n)).toBe(1_000_000n);
    // The slow segment starts here and runs four times as long on the timeline.
    expect(sourceAtClipOffset(ramped, 2_000_000n)).toBe(2_000_000n);
    expect(sourceAtClipOffset(ramped, 4_000_000n)).toBe(2_500_000n);
    // Back to full speed at 6s of timeline, which is 3s of source.
    expect(sourceAtClipOffset(ramped, 6_000_000n)).toBe(3_000_000n);
    expect(sourceAtClipOffset(ramped, 7_000_000n)).toBe(4_000_000n);
  });

  it("is monotonic across the whole clip", () => {
    // A ramp that ever went backwards would show the shot running in reverse
    // at the seam, which is the failure this rules out.
    let previous = -1n;
    for (let t = 0n; t < 8_000_000n; t += 100_000n) {
      const s = sourceAtClipOffset(ramped, t);
      expect(s > previous).toBe(true);
      previous = s;
    }
  });

  it("falls back to the constant rate when there is no ramp", () => {
    const half = clip({ playbackRate: { numerator: 1, denominator: 2 } });
    // Half speed: two seconds of timeline is one second of source.
    expect(sourceAtClipOffset(half, 2_000_000n)).toBe(1_000_000n);
  });

  it("clamps an offset past the end to the last source instant", () => {
    // Callers resolve on a half-open range, so this is defensive rather than
    // reachable; it must not run off into source the clip does not own.
    expect(sourceAtClipOffset(ramped, 99_000_000n)).toBeLessThanOrEqual(
      5_000_000n,
    );
  });
});

describe("rampSpans", () => {
  const ramped = clip({ speedRamp: ramp, timelineDurationUs: "8000000" });

  it("gives each segment its span on both clocks", () => {
    // Audio is scheduled as a span, not sampled at an instant, and one
    // AudioBufferSourceNode carries one rate — so a ramp is one node per row.
    expect(rampSpans(ramped)).toEqual([
      {
        timelineOffsetUs: "0",
        timelineDurationUs: "2000000",
        sourceOffsetUs: "0",
        sourceDurationUs: "2000000",
        rate: { numerator: 1, denominator: 1 },
      },
      {
        timelineOffsetUs: "2000000",
        timelineDurationUs: "4000000",
        sourceOffsetUs: "2000000",
        sourceDurationUs: "1000000",
        rate: { numerator: 1, denominator: 4 },
      },
      {
        timelineOffsetUs: "6000000",
        timelineDurationUs: "2000000",
        sourceOffsetUs: "3000000",
        sourceDurationUs: "2000000",
        rate: { numerator: 1, denominator: 1 },
      },
    ]);
  });

  it("covers exactly the clip's timeline duration", () => {
    // A gap or an overlap here is a gap or a doubled sound in the mixdown.
    const total = rampSpans(ramped).reduce(
      (sum, s) => sum + BigInt(s.timelineDurationUs),
      0n,
    );
    expect(total.toString()).toBe(ramped.timelineDurationUs);
  });

  it("gives an unramped clip one whole-clip span", () => {
    // One shape for callers to handle rather than two code paths.
    const plain = clip({ playbackRate: { numerator: 1, denominator: 2 } });
    expect(rampSpans(plain)).toHaveLength(1);
    expect(rampSpans(plain)[0]?.rate).toEqual({ numerator: 1, denominator: 2 });
  });
});

describe("rateAtClipOffset", () => {
  const ramped = clip({ speedRamp: ramp, timelineDurationUs: "8000000" });

  it("reports the rate in force at an instant", () => {
    expect(rateAtClipOffset(ramped, 0n)).toEqual({
      numerator: 1,
      denominator: 1,
    });
    expect(rateAtClipOffset(ramped, 3_000_000n)).toEqual({
      numerator: 1,
      denominator: 4,
    });
    expect(rateAtClipOffset(ramped, 7_000_000n)).toEqual({
      numerator: 1,
      denominator: 1,
    });
  });
});
