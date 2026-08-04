import { describe, expect, it } from "vitest";
import {
  transitionSchema,
  transitionsFitClip,
  type Transition,
} from "../src/transitions.js";
import { timelineClipSchema } from "../src/entities.js";

const cross: Transition = {
  id: "t1",
  kind: "cross",
  durationUs: "500000",
  easing: "ease-in-out",
};

const baseClip = {
  id: "clip-a",
  assetId: "asset-a",
  trackId: "track-1",
  timelineStartUs: "0",
  timelineDurationUs: "3000000",
  sourceInUs: "0",
  sourceOutUs: "3000000",
  playbackRate: { numerator: 1, denominator: 1 },
  audioGainDb: 0,
  audioPan: 0,
  effects: [],
};

describe("transitionSchema", () => {
  it("accepts a crossfade", () => {
    expect(transitionSchema.parse(cross)).toEqual(cross);
  });

  it("accepts a dip with a colour", () => {
    const dip = {
      id: "t2",
      kind: "dip" as const,
      durationUs: "250000",
      easing: "linear" as const,
      colorHex: "#000000",
    };
    expect(transitionSchema.parse(dip)).toEqual(dip);
  });

  it("rejects a zero-length transition", () => {
    // A zero-duration transition would divide by zero when sampled.
    expect(() =>
      transitionSchema.parse({ ...cross, durationUs: "0" }),
    ).toThrow();
  });

  it("rejects a negative or non-canonical duration", () => {
    expect(() =>
      transitionSchema.parse({ ...cross, durationUs: "-1" }),
    ).toThrow();
    expect(() =>
      transitionSchema.parse({ ...cross, durationUs: "007" }),
    ).toThrow();
  });

  it("rejects a colour on a crossfade", () => {
    // colorHex is meaningless for a cross: there is no colour to dip through.
    expect(() =>
      transitionSchema.parse({ ...cross, colorHex: "#ffffff" }),
    ).toThrow();
  });

  it("rejects a malformed colour", () => {
    expect(() =>
      transitionSchema.parse({
        id: "t3",
        kind: "dip",
        durationUs: "1000",
        easing: "linear",
        colorHex: "black",
      }),
    ).toThrow();
  });

  it("accepts a slide with a direction", () => {
    const slide = {
      id: "t4",
      kind: "slide" as const,
      durationUs: "300000",
      easing: "ease-out" as const,
      direction: "left" as const,
    };
    expect(transitionSchema.parse(slide)).toEqual(slide);
  });

  it("rejects a slide without a direction", () => {
    // There is no sensible default: every direction is equally valid.
    expect(() =>
      transitionSchema.parse({
        id: "t5",
        kind: "slide",
        durationUs: "300000",
        easing: "linear",
      }),
    ).toThrow();
  });

  it("rejects a direction on a non-slide", () => {
    expect(() =>
      transitionSchema.parse({ ...cross, direction: "left" }),
    ).toThrow();
  });

  it("rejects an unknown direction", () => {
    expect(() =>
      transitionSchema.parse({
        id: "t6",
        kind: "slide",
        durationUs: "300000",
        easing: "linear",
        direction: "diagonal",
      }),
    ).toThrow();
  });

  it("rejects a colour on a slide", () => {
    expect(() =>
      transitionSchema.parse({
        id: "t7",
        kind: "slide",
        durationUs: "300000",
        easing: "linear",
        direction: "up",
        colorHex: "#ffffff",
      }),
    ).toThrow();
  });

  it("rejects unknown keys", () => {
    expect(() =>
      transitionSchema.parse({ ...cross, direction: "left" }),
    ).toThrow();
  });
});

describe("timelineClipSchema transitions", () => {
  it("parses a clip with no transitions (schema-v1 compatibility)", () => {
    const parsed = timelineClipSchema.parse(baseClip);
    expect(parsed.transitionIn).toBeUndefined();
    expect(parsed.transitionOut).toBeUndefined();
  });

  it("parses a clip carrying both an in and an out transition", () => {
    const parsed = timelineClipSchema.parse({
      ...baseClip,
      transitionIn: cross,
      transitionOut: { ...cross, id: "t9", kind: "dip", colorHex: "#000000" },
    });
    expect(parsed.transitionIn?.id).toBe("t1");
    expect(parsed.transitionOut?.kind).toBe("dip");
  });
});

describe("transitionsFitClip", () => {
  // The clip schema stays a plain ZodObject so command-schema can `.omit()`
  // from it, so this cross-field rule lives here and is applied by the reducer.
  const CLIP = "3000000";

  it("accepts a clip with no transitions at all", () => {
    expect(transitionsFitClip(CLIP, undefined, undefined)).toBe(true);
  });

  it("rejects a single transition longer than the clip", () => {
    expect(transitionsFitClip(CLIP, "4000000", undefined)).toBe(false);
  });

  it("rejects in + out that together outrun the clip", () => {
    // Overlapping ramps would fight over the same frames.
    expect(transitionsFitClip(CLIP, "2000000", "2000000")).toBe(false);
  });

  it("accepts in + out that exactly fill the clip", () => {
    // A clip that is entirely a fade in followed by a fade out is legitimate.
    expect(transitionsFitClip(CLIP, "1500000", "1500000")).toBe(true);
  });

  it("compares with BigInt, not float precision", () => {
    // Durations beyond 2^53 must still compare exactly.
    expect(
      transitionsFitClip("9007199254740993000", "9007199254740992000", "1000"),
    ).toBe(true);
    expect(
      transitionsFitClip("9007199254740993000", "9007199254740992000", "1001"),
    ).toBe(false);
  });
});
