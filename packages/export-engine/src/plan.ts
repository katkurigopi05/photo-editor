import {
  isAudioEffectType,
  nestedSequenceId,
  rampSpans,
  type EffectInstance,
  type Project,
  type Sequence,
} from "@director/project-schema";
import {
  frameToStartTimeUs,
  framesInDuration,
  resolveAtTimeDeep,
  resolveAudioFades,
  sequenceDurationUs,
  type ActiveClip,
  type ResolvedAudioFades,
} from "@director/playback-controller";
import { isCodecContainerCompatible, type ExportPreset } from "./preset.js";

/**
 * A deterministic export plan derived purely from a project version + preset.
 * No decode/encode/mux is performed — this is the schedule a real encoder would
 * follow. Reproducible: the same inputs always yield the same plan.
 */

export type ExportErrorCode =
  | "SEQUENCE_NOT_FOUND"
  | "EMPTY_SEQUENCE"
  | "INCOMPATIBLE_CODEC"
  | "TIMED_OUT"
  | "ENCODE_FAILED";

export interface ExportError {
  code: ExportErrorCode;
  message: string;
}

export interface AudioClipPlacement {
  trackId: string;
  clipId: string;
  assetId: string;
  timelineStartUs: string;
  timelineDurationUs: string;
  sourceInUs: string;
  sourceOutUs: string;
  gainDb: number;
  pan: number;
  /** Source time consumed per unit of timeline time, as a reduced rational.
   * On a ramped clip this is 1/1 and `spans` carries the real rates. */
  playbackRate: { numerator: number; denominator: number };
  /** The clip's speed as spans on both clocks — one entry unless it is ramped.
   * A sound is scheduled as a span and one source node holds one rate, so a
   * ramped clip is mixed as one node per span rather than one per clip. */
  spans: ReturnType<typeof rampSpans>;
  /** The clip's audio effects (EQ, compressor, fade), in stack order. Visual
   * effects are left out: the mixdown has no use for a blur. */
  effects: EffectInstance[];
  /** Fades after resolving same-track overlaps into crossfades, so the export
   * mixdown ramps exactly where live monitoring did. */
  fades: ResolvedAudioFades;
}

export interface ExportPlan {
  preset: ExportPreset;
  projectVersion: number;
  durationUs: string;
  framesTotal: number;
  audioSampleCount: number;
  audioClips: AudioClipPlacement[];
}

export type ExportPlanResult =
  { ok: true; plan: ExportPlan } | { ok: false; error: ExportError };

export function planExport(
  project: Project,
  sequenceId: string,
  preset: ExportPreset,
): ExportPlanResult {
  if (!isCodecContainerCompatible(preset.videoCodec, preset.container)) {
    return {
      ok: false,
      error: {
        code: "INCOMPATIBLE_CODEC",
        message: `codec ${preset.videoCodec} is not valid in container ${preset.container}`,
      },
    };
  }

  const sequence = project.sequences.find((s) => s.id === sequenceId);
  if (sequence === undefined) {
    return {
      ok: false,
      error: {
        code: "SEQUENCE_NOT_FOUND",
        message: `sequence ${sequenceId} not found`,
      },
    };
  }

  const durationUs = sequenceDurationUs(sequence);
  if (durationUs === "0") {
    return {
      ok: false,
      error: { code: "EMPTY_SEQUENCE", message: "sequence has no clips" },
    };
  }

  const framesTotal = framesInDuration(durationUs, preset.frameRate);
  const audioSampleCount = Number(
    (BigInt(durationUs) * BigInt(preset.audioSampleRate)) / 1_000_000n,
  );

  const audioClips: AudioClipPlacement[] = collectAudio(
    project,
    sequence,
    0n,
    0,
  );

  return {
    ok: true,
    plan: {
      preset,
      projectVersion: project.currentVersion,
      durationUs,
      framesTotal,
      audioSampleCount,
      audioClips,
    },
  };
}

export interface VideoFrameRequest {
  frameIndex: number;
  timelineTimeUs: string;
  layers: ActiveClip[];
}

/**
 * The per-frame render requests for a bounded frame range `[startFrame,
 * startFrame + count)`. Kept lazy/range-based so callers never materialize an
 * entire multi-hour export in memory.
 */
export function planVideoFrames(
  project: Project,
  sequenceId: string,
  preset: ExportPreset,
  startFrame: number,
  count: number,
): VideoFrameRequest[] {
  const sequence = project.sequences.find((s) => s.id === sequenceId);
  if (sequence === undefined) return [];
  const requests: VideoFrameRequest[] = [];
  for (let i = 0; i < count; i++) {
    const frameIndex = startFrame + i;
    const timelineTimeUs = frameToStartTimeUs(frameIndex, preset.frameRate);
    requests.push({
      frameIndex,
      timelineTimeUs,
      // Deep, so a compound clip contributes the media inside it.
      layers: resolveAtTimeDeep(project, sequence.id, timelineTimeUs),
    });
  }
  return requests;
}

/** How deep nesting may go before the mixdown gives up, matching resolution. */
const MAX_AUDIO_NESTING = 8;

/**
 * Every audio placement in a sequence, following compound clips into the
 * sequences they play.
 *
 * A compound clip carries sound as well as picture, and the mixdown walks
 * tracks rather than resolving instants — so unlike the renderer it cannot ask
 * "what is live now" and be done. It has to translate each inner clip's *span*
 * into the outer timeline and clip it to the part the compound clip actually
 * plays.
 *
 * `offsetUs` is where the enclosing sequence's zero sits on the outer timeline.
 */
function collectAudio(
  project: Project,
  sequence: Sequence,
  offsetUs: bigint,
  depth: number,
  window?: { fromUs: bigint; toUs: bigint },
): AudioClipPlacement[] {
  if (depth >= MAX_AUDIO_NESTING) return [];
  const out: AudioClipPlacement[] = [];

  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      const asset = project.assets.find((a) => a.id === clip.assetId);
      const inner = asset ? nestedSequenceId(asset) : null;

      if (inner !== null) {
        // A compound clip plays its source range of the inner sequence, so the
        // inner timeline's zero sits at (this clip's start − its source in).
        const innerSequence = project.sequences.find((s) => s.id === inner);
        if (innerSequence === undefined) continue;
        const clipStart = BigInt(clip.timelineStartUs);
        const sourceIn = BigInt(clip.sourceInUs);
        out.push(
          ...collectAudio(
            project,
            innerSequence,
            offsetUs + clipStart - sourceIn,
            depth + 1,
            { fromUs: sourceIn, toUs: BigInt(clip.sourceOutUs) },
          ),
        );
        continue;
      }

      if (track.kind !== "audio") continue;

      // Clip the span to the part the enclosing compound clip actually plays.
      // Without this, trimming a compound clip would silence its picture while
      // its sound ran on underneath.
      const start = BigInt(clip.timelineStartUs);
      const end = start + BigInt(clip.timelineDurationUs);
      const from = window
        ? start > window.fromUs
          ? start
          : window.fromUs
        : start;
      const to = window ? (end < window.toUs ? end : window.toUs) : end;
      if (to <= from) continue;

      // A clip trimmed at the front starts later in its own source too.
      const trimmedFront = from - start;
      const sourceInUs = (BigInt(clip.sourceInUs) + trimmedFront).toString();
      const sourceOutUs = (
        BigInt(clip.sourceInUs) +
        trimmedFront +
        (to - from)
      ).toString();

      out.push({
        trackId: track.id,
        clipId: clip.id,
        assetId: clip.assetId,
        timelineStartUs: (offsetUs + from).toString(),
        timelineDurationUs: (to - from).toString(),
        sourceInUs,
        sourceOutUs,
        gainDb: clip.audioGainDb,
        pan: clip.audioPan,
        playbackRate: clip.playbackRate,
        spans: rampSpans({ ...clip, sourceInUs, sourceOutUs }),
        effects: clip.effects.filter((fx: EffectInstance) =>
          isAudioEffectType(fx.type),
        ),
        // Neighbours are the rest of this track: an overlap is what turns two
        // adjacent clips into a crossfade.
        fades: resolveAudioFades(clip, track.clips),
      });
    }
  }
  return out;
}
