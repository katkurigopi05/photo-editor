import { z } from "zod";

/**
 * Masks (Phase 2, state layer).
 *
 * A mask is a first-class object that an effect *references*, not a property of
 * the effect — so one region can drive several adjustments, and an adjustment
 * can be moved between regions without being rebuilt.
 *
 * What is stored is geometry, never pixels: a brush stroke is a list of points
 * and a radius. That keeps a project file small, keeps it diffable, and is what
 * makes a mask replay deterministically instead of depending on a bitmap that
 * happened to be rasterized at some resolution.
 *
 * Coordinates are normalized 0…1 against the frame, the same convention as
 * `transform.position_x` and the crop rectangle, so a mask means the same
 * region in a 640px preview and a 4K export.
 */

const finiteNumber = z
  .number()
  .refine((n) => Number.isFinite(n), { message: "must be a finite number" });

const unitValue = finiteNumber.refine(
  (n) => n >= 0 && n <= 1,
  "must be between 0 and 1",
);

/** A point in normalized frame coordinates. */
export const normalizedPointSchema = z
  .object({ x: unitValue, y: unitValue })
  .strict();

/** How a contribution combines with the ones before it in the stack. */
export const maskModeSchema = z.enum(["add", "subtract", "intersect"]);

const base = {
  id: z.string().min(1),
  mode: maskModeSchema,
};

/** A linear gradient: uncovered at `from`, fully covered at `to`. */
export const linearMaskSchema = z
  .object({
    ...base,
    kind: z.literal("linear"),
    from: normalizedPointSchema,
    to: normalizedPointSchema,
  })
  .strict();

/** An elliptical gradient. `radius` is a fraction of width and height, so a
 * circle on a 16:9 frame is written as the ellipse it actually is. */
export const radialMaskSchema = z
  .object({
    ...base,
    kind: z.literal("radial"),
    centre: normalizedPointSchema,
    radius: z
      .object({
        x: finiteNumber.refine((n) => n > 0 && n <= 1, "must be in (0, 1]"),
        y: finiteNumber.refine((n) => n > 0 && n <= 1, "must be in (0, 1]"),
      })
      .strict(),
    feather: unitValue,
    invert: z.boolean(),
  })
  .strict();

/** A swept brush stroke. The points are the stroke; the mask is what they
 * cover at `radius`, which is a fraction of the frame's smaller side. */
export const brushMaskSchema = z
  .object({
    ...base,
    kind: z.literal("brush"),
    points: z.array(normalizedPointSchema).min(1),
    radius: finiteNumber.refine((n) => n > 0 && n <= 1, "must be in (0, 1]"),
    feather: unitValue,
  })
  .strict();

/** Refine by brightness: Lightroom's Range → Luminance. */
export const luminanceRangeMaskSchema = z
  .object({
    ...base,
    kind: z.literal("luminance_range"),
    min: unitValue,
    max: unitValue,
    feather: unitValue,
  })
  .strict();

/** Refine by colour: Lightroom's Range → Colour. */
export const colorRangeMaskSchema = z
  .object({
    ...base,
    kind: z.literal("color_range"),
    colorHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "must be a valid 6-char hex color (#RRGGBB)"),
    tolerance: unitValue,
    feather: unitValue,
  })
  .strict();

export const maskContributionSchema = z
  .discriminatedUnion("kind", [
    linearMaskSchema,
    radialMaskSchema,
    brushMaskSchema,
    luminanceRangeMaskSchema,
    colorRangeMaskSchema,
  ])
  // A discriminated union only accepts plain object members, so the one
  // cross-field rule lives here rather than on the member it belongs to.
  .superRefine((contribution, ctx) => {
    if (
      contribution.kind === "luminance_range" &&
      !(contribution.min < contribution.max)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "min must be below max",
        path: ["max"],
      });
    }
  });

export type MaskContribution = z.infer<typeof maskContributionSchema>;
export type MaskMode = z.infer<typeof maskModeSchema>;

/**
 * A named stack of contributions, composed in order.
 *
 * At least one contribution: an empty mask covers nothing, which would silently
 * disable whatever adjustment references it rather than failing where the
 * mistake was made.
 */
export const clipMaskSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().max(80).optional(),
    contributions: z.array(maskContributionSchema).min(1),
  })
  .strict()
  .refine(
    (mask) =>
      new Set(mask.contributions.map((c) => c.id)).size ===
      mask.contributions.length,
    { message: "contribution ids must be unique", path: ["contributions"] },
  );

export type ClipMask = z.infer<typeof clipMaskSchema>;

/** Masks on one clip: ids unique, so an effect's `maskId` resolves to one. */
export const clipMasksSchema = z
  .array(clipMaskSchema)
  .refine((masks) => new Set(masks.map((m) => m.id)).size === masks.length, {
    message: "mask ids must be unique within a clip",
  });
