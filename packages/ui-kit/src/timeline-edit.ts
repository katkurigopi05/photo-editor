import type { Sequence, TimelineClip, Track } from "@director/project-schema";

/**
 * Timeline editing gestures, resolved to arithmetic.
 *
 * Snapping and rippling decide where clips land, so they are pure functions
 * over project state rather than something the pointer handler works out from
 * pixels: the UI converts a gesture to a candidate time, asks here what the
 * time should actually be, and then dispatches ordinary validated commands.
 *
 * Everything is canonical microsecond strings, and every returned position is
 * clamped nonnegative, so nothing here can produce a payload the command schema
 * would reject.
 */

export type SnapTargetKind = "origin" | "playhead" | "clip-start" | "clip-end";

export interface SnapTarget {
  timeUs: string;
  kind: SnapTargetKind;
}

export interface SnapResult {
  startUs: string;
  /** The target that captured the clip, or null when nothing was in range. */
  snappedTo: SnapTarget | null;
}

export interface RippleMove {
  clipId: string;
  timelineStartUs: string;
}

export interface RippleDeletePlan {
  deleteClipId: string;
  /** Moves to apply after the delete, already in a collision-free order. */
  moves: RippleMove[];
}

export interface RippleTrimPlan {
  clipId: string;
  moves: RippleMove[];
}

const clampNonNegative = (value: bigint): bigint => (value < 0n ? 0n : value);

const clipEnd = (clip: TimelineClip): bigint =>
  BigInt(clip.timelineStartUs) + BigInt(clip.timelineDurationUs);

/**
 * Every time a dragged clip could usefully land on: the origin, the playhead,
 * and both edges of every other clip in the sequence — including clips on other
 * tracks, because aligning a cut across tracks is the main reason to snap.
 */
export function collectSnapTargets(
  sequence: Sequence,
  excludeClipIds: readonly string[],
  playheadUs: string,
): SnapTarget[] {
  const excluded = new Set(excludeClipIds);
  const targets: SnapTarget[] = [
    { timeUs: "0", kind: "origin" },
    { timeUs: playheadUs, kind: "playhead" },
  ];
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      if (excluded.has(clip.id)) continue;
      targets.push({ timeUs: clip.timelineStartUs, kind: "clip-start" });
      targets.push({ timeUs: clipEnd(clip).toString(), kind: "clip-end" });
    }
  }
  return targets;
}

/**
 * Snap a candidate clip start, considering both of the clip's own edges.
 *
 * A clip dropped so its tail nearly meets the next clip should close that seam,
 * which only happens if the tail is allowed to snap and carry the start with
 * it — snapping the head alone is the classic one-frame-gap bug.
 */
export function snapClipStart(
  candidateStartUs: string,
  durationUs: string,
  targets: readonly SnapTarget[],
  toleranceUs: string,
): SnapResult {
  const tolerance = BigInt(toleranceUs);
  const start = BigInt(candidateStartUs);
  const duration = BigInt(durationUs);
  if (tolerance <= 0n) {
    return { startUs: clampNonNegative(start).toString(), snappedTo: null };
  }

  let best: { start: bigint; distance: bigint; target: SnapTarget } | null =
    null;
  for (const target of targets) {
    const time = BigInt(target.timeUs);
    // Once for the head, once for the tail; the tail's snap moves the start.
    for (const proposed of [time, time - duration]) {
      const distance = proposed > start ? proposed - start : start - proposed;
      if (distance > tolerance) continue;
      if (best === null || distance < best.distance) {
        best = { start: proposed, distance, target };
      }
    }
  }

  if (best === null) {
    return { startUs: clampNonNegative(start).toString(), snappedTo: null };
  }
  return {
    startUs: clampNonNegative(best.start).toString(),
    snappedTo: best.target,
  };
}

/**
 * Delete a clip and close the hole it leaves: every later clip on the same
 * track moves back by the deleted clip's duration, keeping the gaps between
 * them.
 *
 * The moves are ordered left to right. That is not cosmetic: they are applied
 * as separate `timeline.move_clip` commands, and a right-to-left order would
 * land a clip on top of one that has not moved yet, which the reducer rejects
 * as an overlap.
 */
export function planRippleDelete(
  track: Track,
  clipId: string,
): RippleDeletePlan {
  const target = track.clips.find((clip) => clip.id === clipId);
  if (target === undefined) return { deleteClipId: clipId, moves: [] };

  const shift = BigInt(target.timelineDurationUs);
  const targetStart = BigInt(target.timelineStartUs);
  const moves = track.clips
    .filter(
      (clip) =>
        clip.id !== clipId && BigInt(clip.timelineStartUs) >= targetStart,
    )
    .sort((a, b) =>
      Number(BigInt(a.timelineStartUs) - BigInt(b.timelineStartUs)),
    )
    .map((clip) => ({
      clipId: clip.id,
      timelineStartUs: clampNonNegative(
        BigInt(clip.timelineStartUs) - shift,
      ).toString(),
    }));

  return { deleteClipId: clipId, moves };
}

/**
 * Shift later clips by the change in a trimmed clip's duration.
 *
 * Shortening ripples left and is applied left to right; lengthening ripples
 * right and must be applied right to left, for the same collision reason as
 * above — the far clip has to vacate its space before its neighbour arrives.
 */
export function planRippleTrim(
  track: Track,
  clipId: string,
  newDurationUs: string,
): RippleTrimPlan {
  const target = track.clips.find((clip) => clip.id === clipId);
  if (target === undefined) return { clipId, moves: [] };

  const delta = BigInt(newDurationUs) - BigInt(target.timelineDurationUs);
  if (delta === 0n) return { clipId, moves: [] };

  const targetEnd = clipEnd(target);
  const later = track.clips
    .filter(
      (clip) => clip.id !== clipId && BigInt(clip.timelineStartUs) >= targetEnd,
    )
    .sort((a, b) =>
      Number(BigInt(a.timelineStartUs) - BigInt(b.timelineStartUs)),
    );
  if (delta > 0n) later.reverse();

  return {
    clipId,
    moves: later.map((clip) => ({
      clipId: clip.id,
      timelineStartUs: clampNonNegative(
        BigInt(clip.timelineStartUs) + delta,
      ).toString(),
    })),
  };
}
