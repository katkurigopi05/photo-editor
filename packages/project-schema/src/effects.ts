import { z } from "zod";
import { microsecondStringSchema } from "./primitives.js";

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

/** Painterly stylization. These are deterministic pixel passes, so the same
 * clip stylizes identically in the preview and in every exported frame. */
export const pencilSketchParamsSchema = z
  .object({
    strength: finiteNumber.refine(
      (n) => n >= 0 && n <= 1,
      "strength must be between 0 and 1",
    ),
    grain: finiteNumber.refine(
      (n) => n >= 0 && n <= 1,
      "grain must be between 0 and 1",
    ),
  })
  .strict();

export const oilPaintingParamsSchema = z
  .object({
    // Kuwahara is O(radius^2) per pixel and runs once per exported frame, so
    // the ceiling is part of the contract rather than a UI convention.
    radiusPx: finiteNumber.refine(
      (n) => n >= 1 && n <= 8,
      "radiusPx must be between 1 and 8",
    ),
  })
  .strict();

export const cartoonParamsSchema = z
  .object({
    levels: finiteNumber.refine(
      (n) => n >= 2 && n <= 16,
      "levels must be between 2 and 16",
    ),
    edgeStrength: finiteNumber.refine(
      (n) => n >= 0 && n <= 1,
      "edgeStrength must be between 0 and 1",
    ),
  })
  .strict();

export const watercolorParamsSchema = z
  .object({
    poolRadiusPx: finiteNumber.refine(
      (n) => n >= 1 && n <= 8,
      "poolRadiusPx must be between 1 and 8",
    ),
    edgeStrength: finiteNumber.refine(
      (n) => n >= 0 && n <= 1,
      "edgeStrength must be between 0 and 1",
    ),
    grain: finiteNumber.refine(
      (n) => n >= 0 && n <= 1,
      "grain must be between 0 and 1",
    ),
  })
  .strict();

export const crosshatchParamsSchema = z
  .object({
    spacingPx: finiteNumber.refine(
      (n) => n >= 2 && n <= 24,
      "spacingPx must be between 2 and 24",
    ),
    darkness: finiteNumber.refine(
      (n) => n >= 0 && n <= 1,
      "darkness must be between 0 and 1",
    ),
  })
  .strict();

export const halftoneParamsSchema = z
  .object({
    cellPx: finiteNumber.refine(
      (n) => n >= 2 && n <= 24,
      "cellPx must be between 2 and 24",
    ),
    angleDegrees: finiteNumber.refine(
      (n) => n >= 0 && n <= 90,
      "angleDegrees must be between 0 and 90",
    ),
  })
  .strict();

/** Colour grading: the four controls a photographer expects to find by name.
 * All four are deterministic point/pixel operations, so a graded clip looks the
 * same in the preview and in every exported frame. */

export const whiteBalanceParamsSchema = z
  .object({
    // Cool (-1, blue) to warm (+1, amber) on the red/blue axis.
    temperature: finiteNumber.refine(
      (n) => n >= -1 && n <= 1,
      "temperature must be between -1 and 1",
    ),
    // Magenta (-1) to green (+1).
    tint: finiteNumber.refine(
      (n) => n >= -1 && n <= 1,
      "tint must be between -1 and 1",
    ),
  })
  .strict();

export const levelsParamsSchema = z
  .object({
    blackPoint: finiteNumber.refine(
      (n) => n >= 0 && n <= 1,
      "blackPoint must be between 0 and 1",
    ),
    whitePoint: finiteNumber.refine(
      (n) => n >= 0 && n <= 1,
      "whitePoint must be between 0 and 1",
    ),
    gamma: finiteNumber.refine(
      (n) => n >= 0.1 && n <= 4,
      "gamma must be between 0.1 and 4",
    ),
  })
  .strict()
  // An inverted or empty window has no render: it would divide by zero or flip
  // the image. Refused here rather than defended against in the renderer.
  .refine((v) => v.blackPoint < v.whitePoint, {
    message: "blackPoint must be below whitePoint",
    path: ["whitePoint"],
  });

const toneBand = finiteNumber.refine(
  (n) => n >= -1 && n <= 1,
  "must be between -1 and 1",
);

export const toneCurveParamsSchema = z
  .object({
    shadows: toneBand,
    midtones: toneBand,
    highlights: toneBand,
  })
  .strict();

export const vibranceParamsSchema = z
  .object({
    amount: finiteNumber.refine(
      (n) => n >= -1 && n <= 1,
      "amount must be between -1 and 1",
    ),
  })
  .strict();

/** Audio effects. They ride the same effect stack as the visual ones — an EQ
 * is as undoable and replayable as a blur — but they are applied by the mixer
 * rather than the renderer, and are meaningless on an image clip. */

export const audioFadeParamsSchema = z
  .object({
    // Microsecond decimal strings, like every other duration in the model: a
    // float here would not survive canonical JSON byte-for-byte.
    fadeInUs: microsecondStringSchema,
    fadeOutUs: microsecondStringSchema,
  })
  .strict();

const eqBandGainDb = finiteNumber.refine(
  (n) => n >= -24 && n <= 24,
  "band gain must be between -24 and 24 dB",
);

export const audioEqParamsSchema = z
  .object({
    lowGainDb: eqBandGainDb,
    midGainDb: eqBandGainDb,
    highGainDb: eqBandGainDb,
  })
  .strict();

export const audioCompressorParamsSchema = z
  .object({
    thresholdDb: finiteNumber.refine(
      (n) => n >= -60 && n <= 0,
      "thresholdDb must be between -60 and 0",
    ),
    // Below 1:1 is an expander, which is a different device with different
    // controls, not a compressor turned down.
    ratio: finiteNumber.refine(
      (n) => n >= 1 && n <= 20,
      "ratio must be between 1 and 20",
    ),
    attackMs: finiteNumber.refine(
      (n) => n >= 0 && n <= 1000,
      "attackMs must be between 0 and 1000",
    ),
    releaseMs: finiteNumber.refine(
      (n) => n >= 0 && n <= 1000,
      "releaseMs must be between 0 and 1000",
    ),
    makeupGainDb: finiteNumber.refine(
      (n) => n >= -24 && n <= 24,
      "makeupGainDb must be between -24 and 24",
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
  "color.white_balance",
  "color.levels",
  "color.tone_curve",
  "color.vibrance",
  "photo.portrait_blur",
  "color.duotone",
  "fx.retro_noise",
  "fx.border",
  "fx.remove_background",
  "transform.crop",
  "fx.text",
  "art.pencil_sketch",
  "art.oil_painting",
  "art.cartoon",
  "art.watercolor",
  "art.crosshatch",
  "art.halftone",
  "audio.fade",
  "audio.eq",
  "audio.compressor",
] as const;

export const effectTypeSchema = z.enum(EFFECT_TYPES);
export type EffectType = z.infer<typeof effectTypeSchema>;

/** Whether a type belongs to the mixer rather than the renderer. The boundary
 * is explicit rather than inferred at each call site: an EQ on an image clip
 * would be silently inert, and a caller that has to remember which prefix means
 * audio will eventually forget. */
export function isAudioEffectType(type: string): boolean {
  return type.startsWith("audio.");
}

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
  "color.white_balance": whiteBalanceParamsSchema,
  "color.levels": levelsParamsSchema,
  "color.tone_curve": toneCurveParamsSchema,
  "color.vibrance": vibranceParamsSchema,
  "photo.portrait_blur": portraitBlurParamsSchema,
  "color.duotone": duotoneParamsSchema,
  "fx.retro_noise": retroNoiseParamsSchema,
  "fx.border": borderParamsSchema,
  "fx.remove_background": removeBackgroundParamsSchema,
  "transform.crop": cropParamsSchema,
  "fx.text": textParamsSchema,
  "art.pencil_sketch": pencilSketchParamsSchema,
  "art.oil_painting": oilPaintingParamsSchema,
  "art.cartoon": cartoonParamsSchema,
  "art.watercolor": watercolorParamsSchema,
  "art.crosshatch": crosshatchParamsSchema,
  "art.halftone": halftoneParamsSchema,
  "audio.fade": audioFadeParamsSchema,
  "audio.eq": audioEqParamsSchema,
  "audio.compressor": audioCompressorParamsSchema,
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
  effect("color.white_balance", whiteBalanceParamsSchema),
  effect("color.levels", levelsParamsSchema),
  effect("color.tone_curve", toneCurveParamsSchema),
  effect("color.vibrance", vibranceParamsSchema),
  effect("photo.portrait_blur", portraitBlurParamsSchema),
  effect("color.duotone", duotoneParamsSchema),
  effect("fx.retro_noise", retroNoiseParamsSchema),
  effect("fx.border", borderParamsSchema),
  effect("fx.remove_background", removeBackgroundParamsSchema),
  effect("transform.crop", cropParamsSchema),
  effect("fx.text", textParamsSchema),
  effect("art.pencil_sketch", pencilSketchParamsSchema),
  effect("art.oil_painting", oilPaintingParamsSchema),
  effect("art.cartoon", cartoonParamsSchema),
  effect("art.watercolor", watercolorParamsSchema),
  effect("art.crosshatch", crosshatchParamsSchema),
  effect("art.halftone", halftoneParamsSchema),
  effect("audio.fade", audioFadeParamsSchema),
  effect("audio.eq", audioEqParamsSchema),
  effect("audio.compressor", audioCompressorParamsSchema),
]);

export type EffectInstance = z.infer<typeof effectInstanceSchema>;
