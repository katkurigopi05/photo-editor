import {
  nestedSequenceId,
  type MediaAsset,
  type Project,
  type Sequence,
} from "@director/project-schema";
import { resolveAtTime, type ActiveClip } from "./timeline.js";

/**
 * Resolving a compound clip: following it down into the sequence it plays.
 *
 * The graph half — what a compound asset points at, and whether the nesting
 * contains a cycle — lives in `@director/project-schema`, because the reducer
 * needs it and cannot depend on this package.
 */

const findSequence = (project: Project, id: string): Sequence | undefined =>
  project.sequences.find((s) => s.id === id);

const findAsset = (project: Project, id: string): MediaAsset | undefined =>
  project.assets.find((a) => a.id === id);

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
