import { describe, expect, it } from "vitest";
import {
  effectInstanceSchema,
  effectParamsSchemas,
  EFFECT_TYPES,
  isAudioEffectType,
} from "../src/effects.js";

/**
 * Audio effects (Phase 4, state layer).
 *
 * They ride the same `EffectInstance` union as the visual effects, so a fade or
 * an EQ is undoable, replayable and inspectable exactly like a blur. The one
 * thing that must not blur is the boundary: an audio effect is meaningless on
 * an image clip, so the catalog carries which side of the mix a type belongs to.
 */

const instance = (type: string, params: unknown): unknown => ({
  id: "fx-1",
  type,
  enabled: true,
  params,
});

describe("audio effect catalog", () => {
  it("registers the audio types", () => {
    for (const type of ["audio.fade", "audio.eq", "audio.compressor"]) {
      expect(EFFECT_TYPES).toContain(type);
      expect(effectParamsSchemas).toHaveProperty(type);
      expect(isAudioEffectType(type)).toBe(true);
    }
  });

  it("does not classify visual effects as audio", () => {
    for (const type of ["color.brightness", "art.cartoon", "fx.text"]) {
      expect(isAudioEffectType(type)).toBe(false);
    }
  });
});

describe("audio.fade", () => {
  it("accepts canonical microsecond strings", () => {
    const parsed = effectInstanceSchema.parse(
      instance("audio.fade", { fadeInUs: "500000", fadeOutUs: "0" }),
    );
    expect(parsed.params).toEqual({ fadeInUs: "500000", fadeOutUs: "0" });
  });

  it("rejects numbers, floats and non-canonical strings", () => {
    // Times are microsecond decimal strings everywhere else in the model; a
    // number here would round-trip differently and break canonical JSON.
    for (const bad of [500000, "0.5", "500_000", "-1", "01", ""]) {
      expect(() =>
        effectInstanceSchema.parse(
          instance("audio.fade", { fadeInUs: bad, fadeOutUs: "0" }),
        ),
      ).toThrow();
    }
  });

  it("rejects unknown params", () => {
    expect(() =>
      effectInstanceSchema.parse(
        instance("audio.fade", {
          fadeInUs: "0",
          fadeOutUs: "0",
          curve: "log",
        }),
      ),
    ).toThrow();
  });
});

describe("audio.eq", () => {
  it("accepts three band gains in dB", () => {
    const parsed = effectInstanceSchema.parse(
      instance("audio.eq", { lowGainDb: -6, midGainDb: 0, highGainDb: 4.5 }),
    );
    expect(parsed.params).toEqual({
      lowGainDb: -6,
      midGainDb: 0,
      highGainDb: 4.5,
    });
  });

  it("rejects gains beyond ±24 dB", () => {
    expect(() =>
      effectInstanceSchema.parse(
        instance("audio.eq", { lowGainDb: 25, midGainDb: 0, highGainDb: 0 }),
      ),
    ).toThrow();
    expect(() =>
      effectInstanceSchema.parse(
        instance("audio.eq", { lowGainDb: 0, midGainDb: -25, highGainDb: 0 }),
      ),
    ).toThrow();
  });
});

describe("audio.compressor", () => {
  const valid = {
    thresholdDb: -24,
    ratio: 4,
    attackMs: 10,
    releaseMs: 250,
    makeupGainDb: 3,
  };

  it("accepts a normal compressor setting", () => {
    expect(
      effectInstanceSchema.parse(instance("audio.compressor", valid)).params,
    ).toEqual(valid);
  });

  it("rejects a ratio below 1, which would be an expander", () => {
    expect(() =>
      effectInstanceSchema.parse(
        instance("audio.compressor", { ...valid, ratio: 0.5 }),
      ),
    ).toThrow();
  });

  it("rejects a positive threshold and out-of-range timings", () => {
    expect(() =>
      effectInstanceSchema.parse(
        instance("audio.compressor", { ...valid, thresholdDb: 6 }),
      ),
    ).toThrow();
    expect(() =>
      effectInstanceSchema.parse(
        instance("audio.compressor", { ...valid, attackMs: -1 }),
      ),
    ).toThrow();
    expect(() =>
      effectInstanceSchema.parse(
        instance("audio.compressor", { ...valid, releaseMs: 5000 }),
      ),
    ).toThrow();
  });
});
