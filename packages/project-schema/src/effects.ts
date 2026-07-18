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

export const EFFECT_TYPES = [
  "color.brightness",
  "color.contrast",
  "transform.opacity",
  "blur.gaussian",
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
]);

export type EffectInstance = z.infer<typeof effectInstanceSchema>;
