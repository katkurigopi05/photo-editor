import type { Sequence } from "@director/project-schema";
import { frameToStartTimeUs, timeToFrameIndex } from "./frame-timing.js";
import { resolveAtTime } from "./timeline.js";

/**
 * Deterministic prefetch planning: given the current time and a look-ahead
 * window, compute the ordered list of frames the decoder should prepare. This
 * is planning only — it performs no decoding, caching, or I/O — so it is a pure
 * function suitable for testing and for driving a real scheduler later.
 */

export interface FrameRequest {
  frameIndex: number;
  timelineTimeUs: string;
  trackId: string;
  clipId: string;
  assetId: string;
  sourceTimeUs: string;
}

/**
 * Plan the frames to prefetch over `[currentTimeUs, currentTimeUs +
 * lookAheadUs]` on the sequence's frame rate. Requests are ordered by ascending
 * frame index, then by track order, and include only frames with an active
 * clip.
 */
export function planPrefetch(
  sequence: Sequence,
  currentTimeUs: string,
  lookAheadUs: string,
): FrameRequest[] {
  const rate = sequence.frameRate;
  if (BigInt(lookAheadUs) < 0n) {
    throw new RangeError("lookAheadUs must be nonnegative");
  }

  const startFrame = timeToFrameIndex(currentTimeUs, rate);
  const endTimeUs = (BigInt(currentTimeUs) + BigInt(lookAheadUs)).toString();
  const endFrame = timeToFrameIndex(endTimeUs, rate);

  const requests: FrameRequest[] = [];
  for (let frame = startFrame; frame <= endFrame; frame++) {
    const timelineTimeUs = frameToStartTimeUs(frame, rate);
    for (const active of resolveAtTime(sequence, timelineTimeUs)) {
      requests.push({
        frameIndex: frame,
        timelineTimeUs,
        trackId: active.trackId,
        clipId: active.clipId,
        assetId: active.assetId,
        sourceTimeUs: active.sourceTimeUs,
      });
    }
  }
  return requests;
}
