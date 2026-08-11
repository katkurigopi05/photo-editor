import {
  isAudioEffectType,
  rampSpans,
  type EffectInstance,
  type Project,
} from "@director/project-schema";
import {
  frameToStartTimeUs,
  framesInDuration,
  resolveAtTime,
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

  const audioClips: AudioClipPlacement[] = [];
  for (const track of sequence.tracks) {
    if (track.kind !== "audio") continue;
    for (const clip of track.clips) {
      audioClips.push({
        trackId: track.id,
        clipId: clip.id,
        assetId: clip.assetId,
        timelineStartUs: clip.timelineStartUs,
        timelineDurationUs: clip.timelineDurationUs,
        sourceInUs: clip.sourceInUs,
        sourceOutUs: clip.sourceOutUs,
        gainDb: clip.audioGainDb,
        pan: clip.audioPan,
        playbackRate: clip.playbackRate,
        spans: rampSpans(clip),
        effects: clip.effects.filter((fx) => isAudioEffectType(fx.type)),
        // Neighbours are the rest of this track: an overlap is what turns two
        // adjacent clips into a crossfade.
        fades: resolveAudioFades(clip, track.clips),
      });
    }
  }

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
      layers: resolveAtTime(sequence, timelineTimeUs),
    });
  }
  return requests;
}
