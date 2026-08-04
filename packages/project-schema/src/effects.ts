import { z } from "zod";

/**
 * Effect data model (Phase 2, state layer).
 *
 * Effects live in project state and are validated by Zod exactly like commands:
 * `type` is a discriminated union and each type has a strict, JSON-serializable
 * params schema. No GPU handles or non-serializable values are ever stored.
 */

const finiteNumber = z
  .number()
  .refine((n) => Number.isFinite(n), { message: "must be a finite number" });

// --- per-type parameter schemas --------------------------------------------

export const brightnessParamsSchema = z
  .object({
    amount: finiteNumber.refine(
      (n) => n >= -1 && n <= 1,
      "amount must be in [-1, 1]",
    ),
  })
  .strict();

export const contrastParamsSchema = z
  .object({
    amount: finiteNumber.refine(
      (n) => n >= 0 && n <= 4,
      "amount must be in [0, 4]",
    ),
  })
  .strict();

export const opacityParamsSchema = z
  .object({
    opacity: finiteNumber.refine(
      (n) => n >= 0 && n <= 1,
      "opacity must be in [0, 1]",
    ),
  })
  .strict();

export const gaussianBlurParamsSchema = z
  .object({
    radiusPx: finiteNumber.refine((n) => n >= 0, "radiusPx must be >= 0"),
  })
  .strict();

export const grayscaleParamsSchema = z
  .object({
    amount: finiteNumber.refine(
      (n) => n >= 0 && n <= 1,
      "amount must be in [0, 1]",
    ),
  })
  .strict();

export const sepiaParamsSchema = z
  .object({
    amount: finiteNumber.refine(
      (n) => n >= 0 && n <= 1,
      "amount must be in [0, 1]",
    ),
  })
  .strict();

export const rotateParamsSchema = z
  .object({
    angleDegrees: finiteNumber.refine(
      (n) => n >= -360 && n <= 360,
      "angle must be between -360 and 360",
    ),
  })
  .strict();

export const flipParamsSchema = z
  .object({
    horizontal: z.boolean(),
    vertical: z.boolean(),
  })
  .strict();

export const hueRotateParamsSchema = z
  .object({
    angleDegrees: finiteNumber.refine(
      (n) => n >= -180 && n <= 180,
      "angle must be between -180 and 180",
    ),
  })
  .strict();

export const saturateParamsSchema = z
  .object({
    amount: finiteNumber.refine(
      (n) => n >= 0 && n <= 5,
      "amount must be between 0 and 5",
    ),
  })
  .strict();

export const invertParamsSchema = z
  .object({
    amount: finiteNumber.refine(
      (n) => n >= 0 && n <= 1,
      "amount must be between 0 and 1",
    ),
  })
  .strict();

export const vignetteParamsSchema = z
  .object({
    amount: finiteNumber.refine(
      (n) => n >= 0 && n <= 1,
      "amount must be between 0 and 1",
    ),
  })
  .strict();

export const tintParamsSchema = z
  .object({
    colorHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "must be a valid 6-char hex color (#RRGGBB)"),
    amount: finiteNumber.refine(
      (n) => n >= 0 && n <= 1,
      "amount must be between 0 and 1",
    ),
  })
  .strict();

export const exposureParamsSchema = z
  .object({
    amount: finiteNumber.refine(
      (n) => n >= -2 && n <= 2,
      "amount must be between -2 and 2",
    ),
  })
  .strict();

export const portraitBlurParamsSchema = z
  .object({
    blurRadiusPx: finiteNumber.refine(
      (n) => n >= 0 && n <= 50,
      "blurRadiusPx must be between 0 and 50",
    ),
    bokehStrength: finiteNumber.refine(
      (n) => n >= 0 && n <= 1,
      "bokehStrength must be between 0 and 1",
    ),
    subjectScale: finiteNumber.refine(
      (n) => n >= 0.5 && n <= 1.5,
      "subjectScale must be between 0.5 and 1.5",
    ),
  })
  .strict();

export const duotoneParamsSchema = z
  .object({
    shadowsHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "must be a valid 6-char hex color (#RRGGBB)"),
    highlightsHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "must be a valid 6-char hex color (#RRGGBB)"),
  })
  .strict();

export const retroNoiseParamsSchema = z
  .object({
    noiseAmount: finiteNumber.refine(
      (n) => n >= 0 && n <= 1,
      "noiseAmount must be between 0 and 1",
    ),
    scanlineSpacing: finiteNumber.refine(
      (n) => n >= 2 && n <= 20,
      "scanlineSpacing must be between 2 and 20",
    ),
  })
  .strict();

export const borderParamsSchema = z
  .object({
    borderColorHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "must be a valid 6-char hex color (#RRGGBB)"),
    borderWidthPx: finiteNumber.refine(
      (n) => n >= 0 && n <= 50,
      "borderWidthPx must be between 0 and 50",
    ),
  })
  .strict();

export const removeBackgroundParamsSchema = z
  .object({
    // When `auto` is true the background color is sampled from the image
    // corners; otherwise `keyColorHex` is keyed out.
    auto: z.boolean(),
    keyColorHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "must be a valid 6-char hex color (#RRGGBB)"),
    threshold: finiteNumber.refine(
      (n) => n >= 0 && n <= 1,
      "threshold must be between 0 and 1",
    ),
    softness: finiteNumber.refine(
      (n) => n >= 0 && n <= 1,
      "softness must be between 0 and 1",
    ),
  })
  .strict();

const unitFraction = finiteNumber.refine(
  (n) => n >= 0 && n <= 1,
  "must be between 0 and 1",
);

/** A non-destructive crop/reframe: the normalized (0..1) sub-rectangle of the
 * source frame to display, scaled to fill the clip's full display area. Real
 * video can't be destructively pixel-cropped like a still photo (it's a live
 * decoded stream), so cropping/reframing a video clip is a declarative,
 * undoable effect instead — same pattern as the other transform.* effects. */
export const cropParamsSchema = z
  .object({
    x: unitFraction,
    y: unitFraction,
    width: unitFraction,
    height: unitFraction,
  })
  .strict()
  .refine((v) => v.x + v.width <= 1, {
    message: "x + width must not exceed 1",
    path: ["width"],
  })
  .refine((v) => v.y + v.height <= 1, {
    message: "y + height must not exceed 1",
    path: ["height"],
  })
  .refine((v) => v.width > 0 && v.height > 0, {
    message: "width and height must be greater than 0",
    path: ["width"],
  });

/** Text burned into the frame. Position is normalized (0..1) against the
 * output, matching transform.position_x/y, so a caption sits in the same place
 * in the preview and in a 4K export rather than drifting with resolution. */
export const textParamsSchema = z
  .object({
    text: z.string().max(500),
    fontSizeRatio: finiteNumber.refine(
      (n) => n > 0 && n <= 0.5,
      "fontSizeRatio must be between 0 and 0.5 of the output height",
    ),
    colorHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "must be a valid 6-char hex color (#RRGGBB)"),
    outlineHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "must be a valid 6-char hex color (#RRGGBB)"),
    x: finiteNumber.refine(
      (n) => n >= 0 && n <= 1,
      "x must be between 0 and 1",
    ),
    y: finiteNumber.refine(
      (n) => n >= 0 && n <= 1,
      "y must be between 0 and 1",
    ),
  })
  .strict();

export const EFFECT_TYPES = [
  "color.brightness",
  "color.contrast",
  "transform.opacity",
  "blur.gaussian",
  "color.grayscale",
  "color.sepia",
  "transform.rotate",
  "transform.flip",
  "color.hue_rotate",
  "color.saturate",
  "color.invert",
  "color.vignette",
  "color.tint",
  "color.exposure",
  "photo.portrait_blur",
  "color.duotone",
  "fx.retro_noise",
  "fx.border",
  "fx.remove_background",
  "transform.crop",
  "fx.text",
] as const;

export const effectTypeSchema = z.enum(EFFECT_TYPES);
export type EffectType = z.infer<typeof effectTypeSchema>;

/** Params schema for each effect type, used to validate `update_effect_params`
 * against an existing effect's type inside the reducer. */
export const effectParamsSchemas = {
  "color.brightness": brightnessParamsSchema,
  "color.contrast": contrastParamsSchema,
  "transform.opacity": opacityParamsSchema,
  "blur.gaussian": gaussianBlurParamsSchema,
  "color.grayscale": grayscaleParamsSchema,
  "color.sepia": sepiaParamsSchema,
  "transform.rotate": rotateParamsSchema,
  "transform.flip": flipParamsSchema,
  "color.hue_rotate": hueRotateParamsSchema,
  "color.saturate": saturateParamsSchema,
  "color.invert": invertParamsSchema,
  "color.vignette": vignetteParamsSchema,
  "color.tint": tintParamsSchema,
  "color.exposure": exposureParamsSchema,
  "photo.portrait_blur": portraitBlurParamsSchema,
  "color.duotone": duotoneParamsSchema,
  "fx.retro_noise": retroNoiseParamsSchema,
  "fx.border": borderParamsSchema,
  "fx.remove_background": removeBackgroundParamsSchema,
  "transform.crop": cropParamsSchema,
  "fx.text": textParamsSchema,
} satisfies Record<EffectType, z.ZodTypeAny>;

function effect<Type extends EffectType, Params extends z.ZodTypeAny>(
  type: Type,
  params: Params,
) {
  return z
    .object({
      id: z.string().min(1),
      type: z.literal(type),
      enabled: z.boolean(),
      params,
    })
    .strict();
}

/** A validated effect instance placed on a clip's effect stack. */
export const effectInstanceSchema = z.discriminatedUnion("type", [
  effect("color.brightness", brightnessParamsSchema),
  effect("color.contrast", contrastParamsSchema),
  effect("transform.opacity", opacityParamsSchema),
  effect("blur.gaussian", gaussianBlurParamsSchema),
  effect("color.grayscale", grayscaleParamsSchema),
  effect("color.sepia", sepiaParamsSchema),
  effect("transform.rotate", rotateParamsSchema),
  effect("transform.flip", flipParamsSchema),
  effect("color.hue_rotate", hueRotateParamsSchema),
  effect("color.saturate", saturateParamsSchema),
  effect("color.invert", invertParamsSchema),
  effect("color.vignette", vignetteParamsSchema),
  effect("color.tint", tintParamsSchema),
  effect("color.exposure", exposureParamsSchema),
  effect("photo.portrait_blur", portraitBlurParamsSchema),
  effect("color.duotone", duotoneParamsSchema),
  effect("fx.retro_noise", retroNoiseParamsSchema),
  effect("fx.border", borderParamsSchema),
  effect("fx.remove_background", removeBackgroundParamsSchema),
  effect("transform.crop", cropParamsSchema),
  effect("fx.text", textParamsSchema),
]);

export type EffectInstance = z.infer<typeof effectInstanceSchema>;
