import type {
  MediaAsset,
  Project,
  Sequence,
  TimelineClip,
  TrackKind,
} from "./entities.js";

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

/**
 * Why a compound clip cannot be dissolved back into its parts, or empty if it
 * can.
 *
 * Dissolving replaces one clip with the several it was made from. That is only
 * honest when the compound clip carries nothing that acts on the *composite*,
 * because such a thing has no per-clip equivalent: a blur over two overlapping
 * layers is not the same picture as a blur over each of them separately, and
 * nothing the engine can do afterwards would make it so. Rather than quietly
 * change the picture, say what is in the way.
 *
 * Trimming and moving are deliberately not blockers. They only decide *which
 * part* of the inner sequence plays and *where*, which every inner clip can be
 * given exactly by windowing — see `dissolveCompound`.
 */
export function dissolveBlockers(clip: TimelineClip): string[] {
  const blockers: string[] = [];
  if (clip.effects.length > 0) {
    blockers.push(
      `it carries ${clip.effects.length} effect${clip.effects.length === 1 ? "" : "s"}, which apply to the whole composite`,
    );
  }
  if ((clip.animations ?? []).length > 0) {
    blockers.push("it is animated, and the animation moves the composite");
  }
  if ((clip.masks ?? []).length > 0) {
    blockers.push("it is masked, and the mask covers the composite");
  }
  if (clip.blendMode !== undefined && clip.blendMode !== "normal") {
    blockers.push(`it blends as ${clip.blendMode} against what is beneath it`);
  }
  if (clip.speedRamp !== undefined) {
    blockers.push("it is speed-ramped");
  }
  if (clip.playbackRate.numerator !== clip.playbackRate.denominator) {
    blockers.push("it is retimed");
  }
  return blockers;
}

/** Where one inner clip lands once its compound clip is dissolved. */
export interface DissolvedPlacement {
  /** The clip inside the nested sequence, unchanged — the source of everything
   * the caller must carry across (effects, animations, gain, blend mode). */
  source: TimelineClip;
  /** Which kind of track it needs in the outer sequence. */
  trackKind: TrackKind;
  timelineStartUs: string;
  timelineDurationUs: string;
  sourceInUs: string;
  sourceOutUs: string;
}

/**
 * The clips a compound clip would become, positioned in the outer timeline.
 *
 * Two clocks, one difference — the same fact `resolveAtTimeDeep` and the audio
 * plan already use, in the shape a *span* needs rather than an instant: the
 * inner timeline's zero sits at (the clip's start − its source in), and only
 * the part between `sourceInUs` and `sourceOutUs` is playing.
 *
 * Inner clips outside that window are dropped rather than placed, because a
 * trimmed compound clip is not showing them. One clipped at the front also
 * starts later in its own source, or its length would be right and its content
 * wrong.
 *
 * One level only. A compound clip nested inside another dissolves into that
 * inner compound clip, not into its contents — one step of an undoable gesture
 * beats one that unpacks an unknown depth.
 */
export function dissolveCompound(
  project: Project,
  clip: TimelineClip,
): DissolvedPlacement[] {
  const asset = findAsset(project, clip.assetId);
  const innerId = asset ? nestedSequenceId(asset) : null;
  if (innerId === null) return [];
  const inner = findSequence(project, innerId);
  if (inner === undefined) return [];

  const clipStart = BigInt(clip.timelineStartUs);
  const fromUs = BigInt(clip.sourceInUs);
  const toUs = BigInt(clip.sourceOutUs);
  const offsetUs = clipStart - fromUs;

  const out: DissolvedPlacement[] = [];
  for (const track of inner.tracks) {
    for (const innerClip of track.clips) {
      const start = BigInt(innerClip.timelineStartUs);
      const end = start + BigInt(innerClip.timelineDurationUs);
      const from = start > fromUs ? start : fromUs;
      const to = end < toUs ? end : toUs;
      if (to <= from) continue;

      const trimmedFront = from - start;
      const sourceIn = BigInt(innerClip.sourceInUs) + trimmedFront;
      out.push({
        source: innerClip,
        trackKind: track.kind,
        timelineStartUs: (offsetUs + from).toString(),
        timelineDurationUs: (to - from).toString(),
        sourceInUs: sourceIn.toString(),
        sourceOutUs: (sourceIn + (to - from)).toString(),
      });
    }
  }
  return out;
}
