import type { MediaAsset, Project, Sequence } from "@director/project-schema";
import { resolveAtTime, type ActiveClip } from "./timeline.js";

/**
 * Compound clips: a clip that plays a whole sequence.
 *
 * Modelled as an asset kind, the way adjustment layers were — a compound clip
 * is an ordinary clip whose asset happens to name a sequence rather than a
 * file, so add, trim, move, effects and every reducer work on it unchanged.
 *
 * What is genuinely new is resolution. The picture at an instant may come from
 * inside another sequence, and that sequence may contain another. So this walks
 * down, translating each level's timing into the timeline the caller asked
 * about, and returns only clips that actually carry media.
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
  if (seen.includes(sequenceId)) return [...seen, sequenceId].join(" → ");
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

/** Deep enough for any sane edit, and a hard stop for one that is not. */
const MAX_NESTING = 8;

/**
 * Resolve the layers live at `timelineUs`, following compound clips down.
 *
 * Positions come back in the **caller's** timeline, not the nested one: a clip
 * two levels down still reports where it sits on the timeline that was asked
 * about, so nothing downstream needs to know how deep it was standing.
 *
 * Recursion is bounded rather than trusting the reducer's cycle check. That
 * check stops one being *created*; a hand-edited project file is not obliged to
 * respect it, and a renderer that locks up is worse than one that draws
 * nothing.
 */
export function resolveAtTimeDeep(
  project: Project,
  sequenceId: string,
  timelineUs: string,
  depth = 0,
  visited: readonly string[] = [],
): ActiveClip[] {
  if (depth >= MAX_NESTING || visited.includes(sequenceId)) return [];
  const sequence = findSequence(project, sequenceId);
  if (sequence === undefined) return [];

  const out: ActiveClip[] = [];
  for (const layer of resolveAtTime(sequence, timelineUs)) {
    const asset = findAsset(project, layer.assetId);
    const inner = asset ? nestedSequenceId(asset) : null;
    if (inner === null) {
      out.push(layer);
      continue;
    }
    // `sourceTimeUs` is how far into the compound clip's *source* we are, and
    // that source is the inner sequence's own timeline — so it is exactly the
    // instant to ask the inner sequence about.
    const innerLayers = resolveAtTimeDeep(
      project,
      inner,
      layer.sourceTimeUs,
      depth + 1,
      [...visited, sequenceId],
    );
    // Translate each inner position into this timeline.
    //
    // At this instant the outer timeline reads `timelineUs` and the inner one
    // reads `layer.sourceTimeUs`, so the two clocks differ by exactly that
    // much. Adding the difference to an inner position gives the outer one —
    // and it stays right when the compound clip is trimmed or retimed, because
    // both readings already account for that.
    const shift = BigInt(timelineUs) - BigInt(layer.sourceTimeUs);
    for (const innerLayer of innerLayers) {
      out.push({
        ...innerLayer,
        timelineStartUs: (
          BigInt(innerLayer.timelineStartUs) + shift
        ).toString(),
      });
    }
  }
  return out;
}
