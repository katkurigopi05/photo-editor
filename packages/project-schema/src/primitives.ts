import { z } from "zod";

/**
 * Primitive value schemas shared across the domain model.
 *
 * Reducers and validation never read the clock, generate IDs, or use
 * randomness; these schemas only describe the shape and constraints of
 * caller-supplied data.
 */

/** A positive safe integer (1 .. Number.MAX_SAFE_INTEGER). */
export const positiveSafeIntSchema = z
  .number()
  .int()
  .positive()
  .refine((n) => Number.isSafeInteger(n), {
    message: "must be a safe integer",
  });

/** A nonnegative safe integer (0 .. Number.MAX_SAFE_INTEGER). */
export const nonNegativeSafeIntSchema = z
  .number()
  .int()
  .nonnegative()
  .refine((n) => Number.isSafeInteger(n), {
    message: "must be a safe integer",
  });

/**
 * Canonical nonnegative-integer decimal string, e.g. microseconds or byte
 * counts. No leading zeros (except "0"), no sign, no decimals, no exponent,
 * no whitespace.
 */
export const canonicalDecimalStringSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, {
    message:
      "must be a canonical nonnegative-integer decimal string matching ^(0|[1-9][0-9]*)$",
  });

/** Microsecond values are stored as canonical decimal strings. */
export const microsecondStringSchema = canonicalDecimalStringSchema;

/** Lowercase SHA-256 hex digest. */
export const checksumSchema = z.string().regex(/^[0-9a-f]{64}$/, {
  message: "must be a lowercase SHA-256 hex string matching ^[0-9a-f]{64}$",
});

/**
 * ISO-8601 instant (date + time + timezone). The value is validated but stored
 * verbatim: it is never parsed-and-reformatted, so canonical byte equality is
 * preserved.
 */
export const isoInstantSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/,
    { message: "must be an ISO-8601 instant with an explicit timezone" },
  )
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "must be a parseable ISO-8601 instant",
  });

/**
 * A rational number. Not required to be reduced, except where a rule names an
 * exact value (see the version-one playback rate).
 */
export const rationalSchema = z
  .object({
    numerator: positiveSafeIntSchema,
    denominator: positiveSafeIntSchema,
  })
  .strict();

/**
 * The only playback rate accepted in version one is exactly 1/1. Unreduced
 * equivalents such as 2/2 are rejected with a validation error at the schema
 * boundary.
 */
export const unitPlaybackRateSchema = z
  .object({
    numerator: z.literal(1),
    denominator: z.literal(1),
  })
  .strict();

export type Rational = z.infer<typeof rationalSchema>;
export type UnitPlaybackRate = z.infer<typeof unitPlaybackRateSchema>;
