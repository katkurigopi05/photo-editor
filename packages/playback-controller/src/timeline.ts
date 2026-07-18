import type { Sequence, TimelineClip, Track } from "@director/project-schema";

/**
 * Resolve which clip is visible on each track at a given timeline time, and the
 * corresponding source time inside that clip. Pure and deterministic; reads a
 * project-state snapshot but never mutates it and never touches the command
 * engine.
 */

export interface ActiveClip {
  trackId: string;
  clipId: string;
  assetId: string;
  timelineStartUs: string;
  /** Source time inside the asset, mapped through the clip's playback rate. */
  sourceTimeUs: string;
}

/** Half-open containment: `[timelineStartUs, timelineStartUs + duration)`. */
function activeClipOnTrack(track: Track, t: bigint): TimelineClip | undefined {
  return track.clips.find((clip) => {
    const start = BigInt(clip.timelineStartUs);
    const end = start + BigInt(clip.timelineDurationUs);
    return start <= t && t < end;
  });
}

/** The active clip on every track at `timelineUs` (tracks with a gap omitted),
 * in track order. */
export function resolveAtTime(
  sequence: Sequence,
  timelineUs: string,
): ActiveClip[] {
  const t = BigInt(timelineUs);
  if (t < 0n) throw new RangeError("time must be nonnegative");

  const result: ActiveClip[] = [];
  for (const track of sequence.tracks) {
    const clip = activeClipOnTrack(track, t);
    if (clip === undefined) continue;
    const offset = t - BigInt(clip.timelineStartUs);
    // sourceIn + offset * playbackRate (v1 rate is 1/1; applied exactly).
    const scaled =
      (offset * BigInt(clip.playbackRate.numerator)) /
      BigInt(clip.playbackRate.denominator);
    const sourceTime = BigInt(clip.sourceInUs) + scaled;
    result.push({
      trackId: track.id,
      clipId: clip.id,
      assetId: clip.assetId,
      timelineStartUs: clip.timelineStartUs,
      sourceTimeUs: sourceTime.toString(),
    });
  }
  return result;
}

/** The end of the last clip across all tracks — the playable duration. */
export function sequenceDurationUs(sequence: Sequence): string {
  let max = 0n;
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      const end =
        BigInt(clip.timelineStartUs) + BigInt(clip.timelineDurationUs);
      if (end > max) max = end;
    }
  }
  return max.toString();
}
