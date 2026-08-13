import type { TimelineClip, Track } from "./entities.js";

/**
 * Magnetic tracks.
 *
 * A magnetic track holds one invariant: **each clip starts where the previous
 * one ended**. No gaps, no overlaps, ever. Deleting a clip closes the gap,
 * inserting one pushes the rest along, and dragging one past another reorders
 * them — all of which fall out of that single rule rather than needing a rule
 * each.
 *
 * Per track rather than for the whole timeline. Final Cut's model — one primary
 * storyline plus clips connected to it — changes what a track *is*, and with it
 * the overlap rule every existing command is written against. This coexists:
 * an unmarked track behaves exactly as it always did, so lanes, adjustment
 * layers above them, compound clips and three-point editing all keep working.
 */

/**
 * Repack a magnetic track's clips end to end, preserving their order.
 *
 * Order comes from where the clips currently sit, so a drag decides the new
 * order and the packing decides the positions. That is what makes dragging one
 * clip past another read as "reorder" rather than "overlap, then refuse".
 *
 * Returns the same array when nothing moves, so a no-op edit does not rewrite
 * the project and make a byte-identical state look like a change.
 */
export function packMagneticClips(
  clips: readonly TimelineClip[],
): TimelineClip[] {
  // Sorted by position, and **stable** — no id tie-break. Two clips can share a
  // start honestly: inserting one at exactly where another begins is the normal
  // case, and there the caller's ordering is the only thing that knows which is
  // the arrival and which is being pushed along. An id tie-break would answer
  // that alphabetically, which is to say arbitrarily.
  //
  // Deliberately unlike `sortClips` in the reducer, which tie-breaks on id
  // because it is ordering a set that may not overlap at all.
  const ordered = [...clips].sort((a, b) => {
    const sa = BigInt(a.timelineStartUs);
    const sb = BigInt(b.timelineStartUs);
    if (sa === sb) return 0;
    return sa < sb ? -1 : 1;
  });

  let at = 0n;
  let changed = ordered.length !== clips.length;
  const packed = ordered.map((clip, index) => {
    const start = at.toString();
    at += BigInt(clip.timelineDurationUs);
    if (clip.timelineStartUs !== start || clips[index]?.id !== clip.id) {
      changed = true;
      return { ...clip, timelineStartUs: start };
    }
    return clip;
  });
  return changed ? packed : [...clips];
}

/** Apply the invariant to a track, if it has one. */
export function normalizeTrack(track: Track): Track {
  if (track.magnetic !== true) return track;
  const packed = packMagneticClips(track.clips);
  // Compared by position rather than by reference: `packMagneticClips` may
  // return fresh objects for clips that did not actually move.
  const same =
    packed.length === track.clips.length &&
    packed.every(
      (clip, i) =>
        clip.id === track.clips[i]?.id &&
        clip.timelineStartUs === track.clips[i]?.timelineStartUs,
    );
  return same ? track : { ...track, clips: packed };
}
