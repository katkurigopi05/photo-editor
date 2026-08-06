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

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

/** Slowest and fastest supported clip speeds. Beyond 4x a decoder is asked for
 * frames faster than it can supply them; below 0.25x every source frame is held
 * so long that the result is a slideshow. */
const MIN_PLAYBACK_RATE = 1 / 4;
const MAX_PLAYBACK_RATE = 4;

/**
 * A clip's playback rate: source time consumed per unit of timeline time. 2/1
 * plays twice as fast (and therefore occupies half the timeline), 1/2 half as
 * fast.
 *
 * A rational rather than a float, because every source-time computation is
 * `sourceIn + offset * numerator / denominator` in exact BigInt arithmetic; a
 * float rate would make the same clip resolve to different source times on
 * different machines. Rates must be in lowest terms so that one speed has
 * exactly one spelling and canonical JSON stays unique — 2/2 is refused, not
 * silently reduced.
 */
export const clipPlaybackRateSchema = rationalSchema
  .refine(
    (r) => greatestCommonDivisor(r.numerator, r.denominator) === 1,
    "playback rate must be in lowest terms",
  )
  .refine((r) => {
    const rate = r.numerator / r.denominator;
    return rate >= MIN_PLAYBACK_RATE && rate <= MAX_PLAYBACK_RATE;
  }, "playback rate must be between 1/4 and 4");

export type Rational = z.infer<typeof rationalSchema>;
export type UnitPlaybackRate = z.infer<typeof unitPlaybackRateSchema>;
export type ClipPlaybackRate = z.infer<typeof clipPlaybackRateSchema>;

const finiteNumberSchema = z
  .number()
  .refine((n) => Number.isFinite(n), { message: "must be a finite number" });

/** Per-clip audio gain in decibels; `0` is unity. Bounded to a sane range. */
export const audioGainDbSchema = finiteNumberSchema.refine(
  (n) => n >= -60 && n <= 12,
  { message: "audio gain must be within [-60, 12] dB" },
);

/** Per-clip stereo pan; `-1` hard left, `0` center, `1` hard right. */
export const audioPanSchema = finiteNumberSchema.refine(
  (n) => n >= -1 && n <= 1,
  { message: "audio pan must be within [-1, 1]" },
);
