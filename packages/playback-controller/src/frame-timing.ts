import type { Rational } from "@director/project-schema";

/**
 * Frame-accurate time conversion using a `Rational` frame rate (frames per
 * second = numerator / denominator). All arithmetic is exact `bigint`, so
 * non-integer rates such as 30000/1001 (29.97 fps) round-trip precisely.
 *
 * Times are canonical microsecond strings (see the domain model). These are
 * pure functions with no clock access.
 */

const US_PER_SECOND = 1_000_000n;

function rateTerms(rate: Rational): { num: bigint; den: bigint } {
  const num = BigInt(rate.numerator);
  const den = BigInt(rate.denominator);
  if (num <= 0n || den <= 0n) {
    throw new RangeError(
      "frame rate numerator and denominator must be positive",
    );
  }
  return { num, den };
}

/** The frame index whose half-open interval contains `timelineUs`.
 * `floor(t * fps) = floor(t * num / (den * 1e6))`. */
export function timeToFrameIndex(timelineUs: string, rate: Rational): number {
  const t = BigInt(timelineUs);
  if (t < 0n) throw new RangeError("time must be nonnegative");
  const { num, den } = rateTerms(rate);
  return Number((t * num) / (den * US_PER_SECOND));
}

/** The canonical microsecond timestamp at which frame `frameIndex` begins.
 * Uses `ceil(n * den * 1e6 / num)` so that
 * `timeToFrameIndex(frameToStartTimeUs(n)) === n`. */
export function frameToStartTimeUs(frameIndex: number, rate: Rational): string {
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    throw new RangeError("frameIndex must be a nonnegative integer");
  }
  const n = BigInt(frameIndex);
  const { num, den } = rateTerms(rate);
  const numerator = n * den * US_PER_SECOND;
  // ceil(numerator / num) for nonnegative values.
  return ((numerator + num - 1n) / num).toString();
}

/** The number of whole frames that fit in `durationUs`. */
export function framesInDuration(durationUs: string, rate: Rational): number {
  return timeToFrameIndex(durationUs, rate);
}
