import type { Rational } from "@director/project-schema";
import {
  frameToStartTimeUs,
  timeToFrameIndex,
} from "@director/playback-controller";

/**
 * Pixel <-> time conversion for the timeline view.
 *
 * The engine stores time as canonical microsecond strings; the UI works in
 * pixels at a given zoom (pixels per second). These helpers convert at the
 * boundary so that only validated canonical values ever reach a command.
 */

/** Convert an absolute pixel position to a canonical, nonnegative microsecond
 * string (clamped at 0). */
export function pixelsToUs(pixels: number, pixelsPerSecond: number): string {
  if (pixelsPerSecond <= 0) {
    throw new RangeError("pixelsPerSecond must be positive");
  }
  const us = Math.round((pixels / pixelsPerSecond) * 1_000_000);
  return (us < 0 ? 0 : us).toString();
}

/** Convert a (possibly negative) pixel delta to a signed integer microsecond
 * amount, for drag deltas. */
export function pixelsToUsDelta(
  deltaPixels: number,
  pixelsPerSecond: number,
): bigint {
  if (pixelsPerSecond <= 0) {
    throw new RangeError("pixelsPerSecond must be positive");
  }
  return BigInt(Math.round((deltaPixels / pixelsPerSecond) * 1_000_000));
}

/** Convert a canonical microsecond string to a pixel position. */
export function usToPixels(us: string, pixelsPerSecond: number): number {
  return (Number(us) / 1_000_000) * pixelsPerSecond;
}

/** Snap a canonical microsecond string to the start of its frame at `rate`. */
export function snapUsToFrame(us: string, rate: Rational): string {
  return frameToStartTimeUs(timeToFrameIndex(us, rate), rate);
}
