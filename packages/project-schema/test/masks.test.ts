import { describe, expect, it } from "vitest";
import { clipMaskSchema, maskContributionSchema } from "../src/masks.js";
import { timelineClipSchema } from "../src/entities.js";
import { effectInstanceSchema } from "../src/effects.js";

/**
 * Masks as project state.
 *
 * The reference note's requirement is precise: a mask is not a property of an
 * adjustment, it is a first-class object an adjustment *references*, and it
 * must serialize and replay deterministically — "a brush stroke is a list of
 * points plus a radius, not a baked bitmap".
 *
 * So the schema stores geometry, never pixels, and stores it in normalized
 * 0…1 coordinates: the same mask has to mean the same region in a 640px
 * preview and a 4K export, exactly like `transform.position_x` and the crop
 * rectangle already do.
 */

const linear = {
  id: "c1",
  kind: "linear" as const,
  mode: "add" as const,
  from: { x: 0, y: 0 },
  to: { x: 1, y: 0 },
};

const radial = {
  id: "c2",
  kind: "radial" as const,
  mode: "add" as const,
  centre: { x: 0.5, y: 0.5 },
  radius: { x: 0.3, y: 0.3 },
  feather: 0.5,
  invert: false,
};

describe("mask contributions", () => {
  it("accepts each kind", () => {
    const kinds = [
      linear,
      radial,
      {
        id: "c3",
        kind: "brush" as const,
        mode: "add" as const,
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.4, y: 0.6 },
        ],
        radius: 0.05,
        feather: 0.5,
      },
      {
        id: "c4",
        kind: "luminance_range" as const,
        mode: "intersect" as const,
        min: 0.2,
        max: 0.8,
        feather: 0.1,
      },
      {
        id: "c5",
        kind: "color_range" as const,
        mode: "subtract" as const,
        colorHex: "#ff5a00",
        tolerance: 0.2,
        feather: 0.1,
      },
    ];
    for (const contribution of kinds) {
      expect(maskContributionSchema.safeParse(contribution).success).toBe(true);
    }
  });

  it("rejects coordinates outside the frame", () => {
    // Normalized means normalized: a point at 1.5 is not "off the right edge",
    // it is a value no renderer can agree on.
    expect(
      maskContributionSchema.safeParse({
        ...linear,
        to: { x: 1.5, y: 0 },
      }).success,
    ).toBe(false);
    expect(
      maskContributionSchema.safeParse({
        ...radial,
        centre: { x: 0.5, y: -0.1 },
      }).success,
    ).toBe(false);
  });

  it("rejects a brush with no points or a zero radius", () => {
    const brush = {
      id: "c3",
      kind: "brush" as const,
      mode: "add" as const,
      points: [{ x: 0.1, y: 0.1 }],
      radius: 0.05,
      feather: 0.5,
    };
    expect(
      maskContributionSchema.safeParse({ ...brush, points: [] }).success,
    ).toBe(false);
    expect(
      maskContributionSchema.safeParse({ ...brush, radius: 0 }).success,
    ).toBe(false);
  });

  it("rejects an inverted luminance window", () => {
    expect(
      maskContributionSchema.safeParse({
        id: "c4",
        kind: "luminance_range",
        mode: "add",
        min: 0.8,
        max: 0.2,
        feather: 0.1,
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown kind, mode, or extra key", () => {
    expect(
      maskContributionSchema.safeParse({ ...linear, kind: "magic" }).success,
    ).toBe(false);
    expect(
      maskContributionSchema.safeParse({ ...linear, mode: "xor" }).success,
    ).toBe(false);
    expect(
      maskContributionSchema.safeParse({ ...linear, softness: 1 }).success,
    ).toBe(false);
  });
});

describe("clip masks", () => {
  const mask = { id: "mask-1", name: "Sky", contributions: [linear, radial] };

  it("accepts a named stack of contributions", () => {
    expect(clipMaskSchema.parse(mask)).toEqual(mask);
  });

  it("requires at least one contribution", () => {
    // An empty mask covers nothing and would silently disable the adjustment
    // that references it.
    expect(
      clipMaskSchema.safeParse({ ...mask, contributions: [] }).success,
    ).toBe(false);
  });

  it("rejects duplicate contribution ids", () => {
    expect(
      clipMaskSchema.safeParse({
        ...mask,
        contributions: [linear, { ...radial, id: linear.id }],
      }).success,
    ).toBe(false);
  });
});

describe("clips and effects carrying masks", () => {
  const clip = {
    id: "clip-1",
    assetId: "asset-1",
    trackId: "track-1",
    timelineStartUs: "0",
    timelineDurationUs: "1000000",
    sourceInUs: "0",
    sourceOutUs: "1000000",
    playbackRate: { numerator: 1, denominator: 1 },
    audioGainDb: 0,
    audioPan: 0,
    effects: [],
  };

  it("parses a clip with no masks exactly as before", () => {
    // Optional, so every project written before masks existed still parses
    // byte-for-byte identically.
    const parsed = timelineClipSchema.parse(clip);
    expect(parsed).not.toHaveProperty("masks");
  });

  it("accepts a clip carrying a mask", () => {
    const parsed = timelineClipSchema.parse({
      ...clip,
      masks: [{ id: "mask-1", contributions: [radial] }],
    });
    expect(parsed.masks?.[0]?.id).toBe("mask-1");
  });

  it("rejects duplicate mask ids on one clip", () => {
    expect(
      timelineClipSchema.safeParse({
        ...clip,
        masks: [
          { id: "mask-1", contributions: [radial] },
          { id: "mask-1", contributions: [linear] },
        ],
      }).success,
    ).toBe(false);
  });

  it("lets an effect reference a mask by id", () => {
    const parsed = effectInstanceSchema.parse({
      id: "fx-1",
      type: "fx.presence",
      enabled: true,
      maskId: "mask-1",
      params: { clarity: 40, texture: 0, dehaze: 0 },
    });
    expect(parsed.maskId).toBe("mask-1");
  });

  it("leaves maskId absent on an unmasked effect", () => {
    const parsed = effectInstanceSchema.parse({
      id: "fx-1",
      type: "color.vibrance",
      enabled: true,
      params: { amount: 0.5 },
    });
    expect(parsed).not.toHaveProperty("maskId");
  });
});
