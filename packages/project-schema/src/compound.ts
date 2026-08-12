import type { MediaAsset, Project, Sequence } from "./entities.js";

/**
 * Compound clips: a clip whose asset names a sequence rather than a file.
 *
 * The graph half lives here, in the schema package, because the reducer needs
 * to refuse a cycle and cannot depend on the playback controller. Resolution —
 * which needs the timeline — stays there.
 */

/** How a compound asset names the sequence it plays. */
export const SEQUENCE_URI_PREFIX = "sequence:";

/** The sequence a compound asset points at, or null if it is not one. */
export function nestedSequenceId(asset: MediaAsset): string | null {
  if (asset.kind !== "sequence") return null;
  if (!asset.originalUri.startsWith(SEQUENCE_URI_PREFIX)) return null;
  const id = asset.originalUri.slice(SEQUENCE_URI_PREFIX.length);
  return id.length > 0 ? id : null;
}

const findSequence = (project: Project, id: string): Sequence | undefined =>
  project.sequences.find((s) => s.id === id);

const findAsset = (project: Project, id: string): MediaAsset | undefined =>
  project.assets.find((a) => a.id === id);

/**
 * The first cycle reachable from `sequenceId`, named, or `null` if there is
 * none.
 *
 * A sequence that contains itself — directly or round a longer ring — cannot be
 * rendered, only recursed into forever. The reducer refuses to create one, and
 * this is what it asks.
 */
export function compoundCycle(
  project: Project,
  sequenceId: string,
  seen: readonly string[] = [],
): string | null {
  if (seen.includes(sequenceId)) return [...seen, sequenceId].join(" -> ");
  const sequence = findSequence(project, sequenceId);
  if (sequence === undefined) return null;
  const trail = [...seen, sequenceId];
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      const asset = findAsset(project, clip.assetId);
      if (asset === undefined) continue;
      const inner = nestedSequenceId(asset);
      if (inner === null) continue;
      const found = compoundCycle(project, inner, trail);
      if (found !== null) return found;
    }
  }
  return null;
}
