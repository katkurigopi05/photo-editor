import { describe, expect, it } from "vitest";
import {
  effectInstanceSchema,
  effectParamsSchemas,
  EFFECT_TYPES,
} from "../src/effects.js";

/**
 * The grading effects (Phase 2, state layer).
 *
 * Grading params are numbers a UI slider produces, which is exactly why they
 * need the same strictness as every other command payload: an out-of-range
 * black point or an inverted levels window would render one way in the preview
 * and another in a re-decoded export, and a project file carrying it would
 * replay differently. The schema is where that is refused.
 */

const GRADING_TYPES = [
  "color.white_balance",
  "color.levels",
  "color.tone_curve",
  "color.vibrance",
] as const;

const instance = (type: string, params: unknown): unknown => ({
  id: "fx-1",
  type,
  enabled: true,
  params,
});

describe("grading effect types", () => {
  it("registers every grading type in the shared catalog", () => {
    for (const type of GRADING_TYPES) {
      expect(EFFECT_TYPES).toContain(type);
      expect(effectParamsSchemas).toHaveProperty(type);
    }
  });
});

describe("color.white_balance", () => {
  it("accepts temperature and tint across the full range", () => {
    for (const value of [-1, -0.25, 0, 0.5, 1]) {
      const parsed = effectInstanceSchema.parse(
        instance("color.white_balance", { temperature: value, tint: -value }),
      );
      expect(parsed.params).toEqual({ temperature: value, tint: -value });
    }
  });

  it("rejects values outside [-1, 1]", () => {
    expect(() =>
      effectInstanceSchema.parse(
        instance("color.white_balance", { temperature: 1.5, tint: 0 }),
      ),
    ).toThrow();
    expect(() =>
      effectInstanceSchema.parse(
        instance("color.white_balance", { temperature: 0, tint: -2 }),
      ),
    ).toThrow();
  });

  it("rejects unknown params and non-finite numbers", () => {
    expect(() =>
      effectInstanceSchema.parse(
        instance("color.white_balance", {
          temperature: 0,
          tint: 0,
          strength: 1,
        }),
      ),
    ).toThrow();
    expect(() =>
      effectInstanceSchema.parse(
        instance("color.white_balance", { temperature: Number.NaN, tint: 0 }),
      ),
    ).toThrow();
  });
});

describe("color.levels", () => {
  it("accepts a well-formed window", () => {
    const parsed = effectInstanceSchema.parse(
      instance("color.levels", {
        blackPoint: 0.1,
        whitePoint: 0.9,
        gamma: 1.2,
      }),
    );
    expect(parsed.params).toEqual({
      blackPoint: 0.1,
      whitePoint: 0.9,
      gamma: 1.2,
    });
  });

  it("rejects a black point at or above the white point", () => {
    // An inverted window has no meaningful render: it would either divide by
    // zero or silently invert the image.
    expect(() =>
      effectInstanceSchema.parse(
        instance("color.levels", {
          blackPoint: 0.6,
          whitePoint: 0.4,
          gamma: 1,
        }),
      ),
    ).toThrow();
    expect(() =>
      effectInstanceSchema.parse(
        instance("color.levels", {
          blackPoint: 0.5,
          whitePoint: 0.5,
          gamma: 1,
        }),
      ),
    ).toThrow();
  });

  it("rejects points outside [0, 1] and gamma outside [0.1, 4]", () => {
    expect(() =>
      effectInstanceSchema.parse(
        instance("color.levels", { blackPoint: -0.1, whitePoint: 1, gamma: 1 }),
      ),
    ).toThrow();
    expect(() =>
      effectInstanceSchema.parse(
        instance("color.levels", { blackPoint: 0, whitePoint: 1.2, gamma: 1 }),
      ),
    ).toThrow();
    expect(() =>
      effectInstanceSchema.parse(
        instance("color.levels", { blackPoint: 0, whitePoint: 1, gamma: 0 }),
      ),
    ).toThrow();
    expect(() =>
      effectInstanceSchema.parse(
        instance("color.levels", { blackPoint: 0, whitePoint: 1, gamma: 5 }),
      ),
    ).toThrow();
  });
});

describe("color.tone_curve", () => {
  it("accepts all three bands across [-1, 1]", () => {
    const parsed = effectInstanceSchema.parse(
      instance("color.tone_curve", {
        shadows: -1,
        midtones: 0,
        highlights: 1,
      }),
    );
    expect(parsed.params).toEqual({
      shadows: -1,
      midtones: 0,
      highlights: 1,
    });
  });

  it("rejects a band outside [-1, 1] or a missing band", () => {
    expect(() =>
      effectInstanceSchema.parse(
        instance("color.tone_curve", {
          shadows: 0,
          midtones: 0,
          highlights: 1.01,
        }),
      ),
    ).toThrow();
    expect(() =>
      effectInstanceSchema.parse(
        instance("color.tone_curve", { shadows: 0, midtones: 0 }),
      ),
    ).toThrow();
  });
});

describe("color.vibrance", () => {
  it("accepts an amount across [-1, 1]", () => {
    for (const amount of [-1, 0, 0.4, 1]) {
      expect(
        effectInstanceSchema.parse(instance("color.vibrance", { amount }))
          .params,
      ).toEqual({ amount });
    }
  });

  it("rejects an amount outside [-1, 1]", () => {
    expect(() =>
      effectInstanceSchema.parse(instance("color.vibrance", { amount: 2 })),
    ).toThrow();
  });
});
