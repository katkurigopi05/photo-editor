import { describe, expect, it } from "vitest";
import {
  BLEND_MODES,
  blendModeSchema,
  compositeOperation,
} from "../src/blend.js";
import { timelineClipSchema } from "../src/entities.js";

/**
 * Blend modes.
 *
 * The rules worth pinning are the two that would be invisible until a project
 * broke: that the names are exactly the ones a canvas accepts, and that a clip
 * nobody has touched carries no member at all — which is what keeps every
 * project written before blend modes parsing byte-for-byte identically.
 */

const clip = (extra: Record<string, unknown> = {}) => ({
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
  ...extra,
});

describe("blendModeSchema", () => {
  it("accepts every mode it offers", () => {
    for (const mode of BLEND_MODES) {
      expect(blendModeSchema.safeParse(mode).success).toBe(true);
    }
  });

  it("offers the W3C compositing modes and nothing invented", () => {
    // Every name here is one `globalCompositeOperation` accepts, which is why
    // no translation table is needed in any of the three render paths.
    expect([...BLEND_MODES].sort()).toEqual([
      "color",
      "color-burn",
      "color-dodge",
      "darken",
      "difference",
      "exclusion",
      "hard-light",
      "hue",
      "lighten",
      "luminosity",
      "multiply",
      "normal",
      "overlay",
      "saturation",
      "screen",
      "soft-light",
    ]);
  });

  it("rejects a canvas operation that is not a blend mode", () => {
    // These are real `globalCompositeOperation` values, and none of them
    // describes how two pictures mix — accepting one would let a project ask
    // for a clip that erases what is beneath it.
    for (const value of ["source-over", "destination-out", "copy", "xor"]) {
      expect(blendModeSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("compositeOperation", () => {
  it("maps normal to the canvas default", () => {
    // Passing "normal" straight through would be silently ignored, leaving
    // whatever the previous layer set — one clip's Multiply applying to the
    // next.
    expect(compositeOperation("normal")).toBe("source-over");
  });

  it("passes every other mode through unchanged", () => {
    for (const mode of BLEND_MODES) {
      if (mode === "normal") continue;
      expect(compositeOperation(mode)).toBe(mode);
    }
  });
});

describe("clips carrying a blend mode", () => {
  it("parses a clip with no blend mode exactly as before", () => {
    expect(timelineClipSchema.parse(clip())).not.toHaveProperty("blendMode");
  });

  it("accepts a clip with one", () => {
    expect(timelineClipSchema.parse(clip({ blendMode: "multiply" }))).toEqual(
      clip({ blendMode: "multiply" }),
    );
  });

  it("rejects an unknown mode", () => {
    expect(
      timelineClipSchema.safeParse(clip({ blendMode: "vivid-light" })).success,
    ).toBe(false);
  });
});
