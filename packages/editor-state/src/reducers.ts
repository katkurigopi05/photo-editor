import {
  animationTrackSchema,
  effectParamsSchemas,
  isAssetCompatibleWithTrack,
  transitionsFitClip,
  type AnimationKeyframe,
  type AnimationTrack,
  type AssetRating,
  type ClipMask,
  type EffectInstance,
  type MediaAsset,
  type Project,
  type Sequence,
  type TimelineClip,
  type Track,
  type Transition,
  type TransitionSide,
} from "@director/project-schema";
import type {
  InternalProjectCommand,
  ProjectCommand,
  ProjectOperation,
} from "@director/command-schema";
import { makeError } from "./errors.js";
import type { CommandError } from "./types.js";

export type ForwardResult =
  | { ok: true; project: Project; inverse: InternalProjectCommand }
  | { ok: false; error: CommandError };

// --- small pure helpers -----------------------------------------------------

const toBig = (s: string): bigint => BigInt(s);

function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Deterministic clip ordering: by numeric `timelineStartUs`, then by `id`. */
function sortClips(clips: readonly TimelineClip[]): TimelineClip[] {
  return [...clips].sort((a, b) => {
    const da = toBig(a.timelineStartUs);
    const db = toBig(b.timelineStartUs);
    if (da < db) return -1;
    if (da > db) return 1;
    return compareIds(a.id, b.id);
  });
}

/** Deterministic track ordering: by ascending `index`, then by `id`. */
function sortTracks(tracks: readonly Track[]): Track[] {
  return [...tracks].sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index;
    return compareIds(a.id, b.id);
  });
}

/** Half-open overlap test on `[start, start+duration)`. Adjacency is allowed. */
function overlaps(aStart: bigint, aEnd: bigint, other: TimelineClip): boolean {
  const aStartClamped = aStart;
  const oStart = toBig(other.timelineStartUs);
  const oEnd = oStart + toBig(other.timelineDurationUs);
  return aStartClamped < oEnd && oStart < aEnd;
}

/** Microseconds two half-open ranges share; `0n` when they merely touch. */
function overlapAmount(
  aStart: bigint,
  aEnd: bigint,
  other: TimelineClip,
): bigint {
  const oStart = toBig(other.timelineStartUs);
  const oEnd = oStart + toBig(other.timelineDurationUs);
  const start = aStart > oStart ? aStart : oStart;
  const end = aEnd < oEnd ? aEnd : oEnd;
  return end > start ? end - start : 0n;
}

/**
 * A same-track transition is the single case where two clips may occupy the
 * same span: during the overlap both are drawn and the later one moves or
 * fades in over the earlier one.
 *
 * The later-starting clip owns the transition, because it is the one arriving.
 * The ramp must be at least as long as the overlap — a shorter one would
 * finish while the earlier clip is still on screen, leaving frames where two
 * clips are both fully opaque and the top one simply hides the other.
 *
 * `cross` and `slide` both qualify: a crossfade reveals the clip underneath by
 * ramping alpha, a slide reveals it by genuinely travelling off the region it
 * occupies. A `dip` does not — it ramps against its own colour and never shows
 * what is behind it, so an overlap under a dip would just be a hidden clip.
 */
function transitionCoversOverlap(
  start: bigint,
  end: bigint,
  movingTransitionIn: Transition | undefined,
  other: TimelineClip,
): boolean {
  const overlap = overlapAmount(start, end, other);
  if (overlap === 0n) return true;
  const otherStart = toBig(other.timelineStartUs);
  const later = start >= otherStart ? movingTransitionIn : other.transitionIn;
  return (
    later !== undefined &&
    (later.kind === "cross" || later.kind === "slide") &&
    toBig(later.durationUs) >= overlap
  );
}

/** The first clip a span genuinely conflicts with, skipping any overlap that a
 * transition legitimately covers. */
function findOverlapConflict(
  clips: readonly TimelineClip[],
  start: bigint,
  end: bigint,
  movingTransitionIn: Transition | undefined,
  excludeClipId?: string,
): TimelineClip | undefined {
  return clips.find(
    (c) =>
      c.id !== excludeClipId &&
      overlaps(start, end, c) &&
      !transitionCoversOverlap(start, end, movingTransitionIn, c),
  );
}

function findSequence(project: Project, id: string): Sequence | undefined {
  return project.sequences.find((s) => s.id === id);
}

interface ClipLocation {
  track: Track;
  trackIndex: number;
  clip: TimelineClip;
  clipIndex: number;
}

function locateClip(
  sequence: Sequence,
  clipId: string,
): ClipLocation | undefined {
  for (let trackIndex = 0; trackIndex < sequence.tracks.length; trackIndex++) {
    const track = sequence.tracks[trackIndex]!;
    const clipIndex = track.clips.findIndex((c) => c.id === clipId);
    if (clipIndex >= 0) {
      return { track, trackIndex, clip: track.clips[clipIndex]!, clipIndex };
    }
  }
  return undefined;
}

function allTracks(project: Project): Track[] {
  return project.sequences.flatMap((s) => s.tracks);
}

function allClips(project: Project): TimelineClip[] {
  return project.sequences.flatMap((s) => s.tracks.flatMap((t) => t.clips));
}

function replaceSequence(project: Project, sequence: Sequence): Sequence[] {
  return project.sequences.map((s) => (s.id === sequence.id ? sequence : s));
}

function findAsset(project: Project, id: string): MediaAsset | undefined {
  return project.assets.find((a) => a.id === id);
}

// --- version / existence preconditions --------------------------------------

/** Precondition 2 (existence) and 3 (version) for non-create commands. */
function requireLiveProject(
  project: Project | null,
  baseVersion: number,
): { ok: false; error: CommandError } | { ok: true; project: Project } {
  if (project === null) {
    return {
      ok: false,
      error: makeError("PROJECT_NOT_FOUND", "no project exists"),
    };
  }
  if (baseVersion !== project.currentVersion) {
    return {
      ok: false,
      error: makeError(
        "VERSION_CONFLICT",
        `baseVersion ${baseVersion} does not match current version ${project.currentVersion}`,
        ["baseVersion"],
        { expected: project.currentVersion, actual: baseVersion },
      ),
    };
  }
  return { ok: true, project };
}

// --- forward reducers -------------------------------------------------------

export function applyForward(
  project: Project | null,
  command: ProjectCommand,
): ForwardResult {
  switch (command.commandType) {
    case "project.create":
      return createProject(project, command);
    case "asset.register":
      return registerAsset(project, command);
    case "asset.set_rating":
      return setAssetRating(project, command);
    case "timeline.create_sequence":
      return createSequence(project, command);
    case "timeline.add_track":
      return addTrack(project, command);
    case "timeline.add_clip":
      return addClip(project, command);
    case "timeline.move_clip":
      return moveClip(project, command);
    case "timeline.trim_clip":
      return trimClip(project, command);
    case "timeline.delete_clip":
      return deleteClip(project, command);
    case "timeline.add_effect":
      return addEffect(project, command);
    case "timeline.update_effect_params":
      return updateEffectParams(project, command);
    case "timeline.remove_effect":
      return removeEffect(project, command);
    case "timeline.reorder_effects":
      return reorderEffects(project, command);
    case "timeline.update_clip_effects":
      return updateClipEffects(project, command);
    case "timeline.set_clip_audio_gain":
      return setClipAudioGain(project, command);
    case "timeline.set_clip_speed":
      return setClipSpeed(project, command);
    case "timeline.add_mask":
      return addMask(project, command);
    case "timeline.update_mask":
      return updateMask(project, command);
    case "timeline.remove_mask":
      return removeMask(project, command);
    case "timeline.set_effect_mask":
      return setEffectMask(project, command);
    case "timeline.set_clip_audio_pan":
      return setClipAudioPan(project, command);
    case "timeline.add_keyframe":
      return addKeyframe(project, command);
    case "timeline.update_keyframe":
      return updateKeyframe(project, command);
    case "timeline.remove_keyframe":
      return removeKeyframe(project, command);
    case "timeline.update_clip_animations":
      return updateClipAnimations(project, command);
    case "timeline.set_clip_transition":
      return setClipTransition(project, command);
    default:
      return {
        ok: false,
        error: makeError("VALIDATION_ERROR", "unknown command type"),
      };
  }
}

function createProject(
  project: Project | null,
  command: Extract<ProjectCommand, { commandType: "project.create" }>,
): ForwardResult {
  if (project !== null) {
    return {
      ok: false,
      error: makeError("PROJECT_ALREADY_EXISTS", "a project already exists"),
    };
  }
  if (command.baseVersion !== 0) {
    return {
      ok: false,
      error: makeError(
        "VERSION_CONFLICT",
        `project.create requires baseVersion 0, received ${command.baseVersion}`,
        ["baseVersion"],
        { expected: 0, actual: command.baseVersion },
      ),
    };
  }
  const p = command.payload;
  const created: Project = {
    id: p.projectId,
    ownerId: p.ownerId,
    name: p.name,
    schemaVersion: 1,
    currentVersion: 1,
    settings: {
      defaultFrameRate: {
        numerator: p.settings.defaultFrameRate.numerator,
        denominator: p.settings.defaultFrameRate.denominator,
      },
    },
    assets: [],
    sequences: [],
    createdAt: command.createdAt,
    updatedAt: command.createdAt,
  };
  return {
    ok: true,
    project: created,
    inverse: { commandType: "internal.remove_project", payload: {} },
  };
}

function registerAsset(
  projectOrNull: Project | null,
  command: Extract<ProjectCommand, { commandType: "asset.register" }>,
): ForwardResult {
  const pre = requireLiveProject(projectOrNull, command.baseVersion);
  if (!pre.ok) return pre;
  const project = pre.project;
  const asset = command.payload.asset;

  if (asset.projectId !== project.id) {
    return {
      ok: false,
      error: makeError(
        "VALIDATION_ERROR",
        "asset projectId does not match the current project",
        ["payload", "asset", "projectId"],
      ),
    };
  }
  if (project.assets.some((a) => a.id === asset.id)) {
    return {
      ok: false,
      error: makeError("DUPLICATE_ID", `asset id ${asset.id} already exists`, [
        "payload",
        "asset",
        "id",
      ]),
    };
  }

  const prevUpdatedAt = project.updatedAt;
  const next: Project = {
    ...project,
    assets: [...project.assets, structuredClone(asset)],
    updatedAt: command.createdAt,
    currentVersion: project.currentVersion + 1,
  };
  return {
    ok: true,
    project: next,
    inverse: {
      commandType: "internal.remove_asset",
      payload: { assetId: asset.id, restoreUpdatedAt: prevUpdatedAt },
    },
  };
}

function withAssetRating(
  asset: MediaAsset,
  rating: AssetRating | null,
): MediaAsset {
  if (rating === null) {
    const { rating: _removed, ...unrated } = asset;
    return unrated as MediaAsset;
  }
  return { ...asset, rating };
}

function setAssetRating(
  projectOrNull: Project | null,
  command: Extract<ProjectCommand, { commandType: "asset.set_rating" }>,
): ForwardResult {
  const pre = requireLiveProject(projectOrNull, command.baseVersion);
  if (!pre.ok) return pre;
  const project = pre.project;
  const { assetId, rating } = command.payload;
  const asset = findAsset(project, assetId);
  if (asset === undefined) {
    return {
      ok: false,
      error: makeError("ASSET_NOT_FOUND", `asset ${assetId} not found`, [
        "payload",
        "assetId",
      ]),
    };
  }

  const previous = asset.rating ?? null;
  const prevUpdatedAt = project.updatedAt;
  return {
    ok: true,
    project: {
      ...project,
      assets: project.assets.map((candidate) =>
        candidate.id === assetId
          ? withAssetRating(candidate, rating)
          : candidate,
      ),
      updatedAt: command.createdAt,
      currentVersion: project.currentVersion + 1,
    },
    inverse: {
      commandType: "internal.set_asset_rating",
      payload: {
        assetId,
        rating: previous,
        restoreUpdatedAt: prevUpdatedAt,
      },
    },
  };
}

function createSequence(
  projectOrNull: Project | null,
  command: Extract<ProjectCommand, { commandType: "timeline.create_sequence" }>,
): ForwardResult {
  const pre = requireLiveProject(projectOrNull, command.baseVersion);
  if (!pre.ok) return pre;
  const project = pre.project;
  const input = command.payload.sequence;

  if (project.sequences.some((s) => s.id === input.id)) {
    return {
      ok: false,
      error: makeError(
        "DUPLICATE_ID",
        `sequence id ${input.id} already exists`,
        ["payload", "sequence", "id"],
      ),
    };
  }

  const prevUpdatedAt = project.updatedAt;
  const sequence: Sequence = { ...structuredClone(input), tracks: [] };
  const next: Project = {
    ...project,
    sequences: [...project.sequences, sequence],
    updatedAt: command.createdAt,
    currentVersion: project.currentVersion + 1,
  };
  return {
    ok: true,
    project: next,
    inverse: {
      commandType: "internal.remove_sequence",
      payload: { sequenceId: input.id, restoreUpdatedAt: prevUpdatedAt },
    },
  };
}

function addTrack(
  projectOrNull: Project | null,
  command: Extract<ProjectCommand, { commandType: "timeline.add_track" }>,
): ForwardResult {
  const pre = requireLiveProject(projectOrNull, command.baseVersion);
  if (!pre.ok) return pre;
  const project = pre.project;
  const { sequenceId, track } = command.payload;

  const sequence = findSequence(project, sequenceId);
  if (sequence === undefined) {
    return {
      ok: false,
      error: makeError(
        "SEQUENCE_NOT_FOUND",
        `sequence ${sequenceId} not found`,
        ["payload", "sequenceId"],
      ),
    };
  }
  if (allTracks(project).some((t) => t.id === track.id)) {
    return {
      ok: false,
      error: makeError("DUPLICATE_ID", `track id ${track.id} already exists`, [
        "payload",
        "track",
        "id",
      ]),
    };
  }
  if (sequence.tracks.some((t) => t.index === track.index)) {
    return {
      ok: false,
      error: makeError(
        "DUPLICATE_ID",
        `track index ${track.index} already used in sequence ${sequenceId}`,
        ["payload", "track", "index"],
      ),
    };
  }

  const prevUpdatedAt = project.updatedAt;
  const newTrack: Track = { ...structuredClone(track), clips: [] };
  const nextSequence: Sequence = {
    ...sequence,
    tracks: sortTracks([...sequence.tracks, newTrack]),
  };
  const next: Project = {
    ...project,
    sequences: replaceSequence(project, nextSequence),
    updatedAt: command.createdAt,
    currentVersion: project.currentVersion + 1,
  };
  return {
    ok: true,
    project: next,
    inverse: {
      commandType: "internal.remove_track",
      payload: {
        sequenceId,
        trackId: track.id,
        restoreUpdatedAt: prevUpdatedAt,
      },
    },
  };
}

function addClip(
  projectOrNull: Project | null,
  command: Extract<ProjectCommand, { commandType: "timeline.add_clip" }>,
): ForwardResult {
  const pre = requireLiveProject(projectOrNull, command.baseVersion);
  if (!pre.ok) return pre;
  const project = pre.project;
  const { sequenceId, trackId, clip, insertionIndex } = command.payload;

  const sequence = findSequence(project, sequenceId);
  if (sequence === undefined) {
    return {
      ok: false,
      error: makeError(
        "SEQUENCE_NOT_FOUND",
        `sequence ${sequenceId} not found`,
        ["payload", "sequenceId"],
      ),
    };
  }
  const track = sequence.tracks.find((t) => t.id === trackId);
  if (track === undefined) {
    return {
      ok: false,
      error: makeError("TRACK_NOT_FOUND", `track ${trackId} not found`, [
        "payload",
        "trackId",
      ]),
    };
  }
  const asset = findAsset(project, clip.assetId);
  if (asset === undefined) {
    return {
      ok: false,
      error: makeError("ASSET_NOT_FOUND", `asset ${clip.assetId} not found`, [
        "payload",
        "clip",
        "assetId",
      ]),
    };
  }
  if (allClips(project).some((c) => c.id === clip.id)) {
    return {
      ok: false,
      error: makeError("DUPLICATE_ID", `clip id ${clip.id} already exists`, [
        "payload",
        "clip",
        "id",
      ]),
    };
  }
  if (!isAssetCompatibleWithTrack(track.kind, asset.kind)) {
    return {
      ok: false,
      error: makeError(
        "INCOMPATIBLE_TRACK",
        `asset kind ${asset.kind} is not compatible with a ${track.kind} track`,
        ["payload", "trackId"],
        { trackKind: track.kind, assetKind: asset.kind },
      ),
    };
  }

  const rangeError = validateSourceRange(
    asset,
    clip.sourceInUs,
    clip.sourceOutUs,
    ["payload", "clip"],
  );
  if (rangeError) return { ok: false, error: rangeError };

  const durationUs = (
    toBig(clip.sourceOutUs) - toBig(clip.sourceInUs)
  ).toString();

  if (insertionIndex !== undefined) {
    if (insertionIndex < 0 || insertionIndex > track.clips.length) {
      return {
        ok: false,
        error: makeError(
          "OUT_OF_BOUNDS",
          `insertionIndex ${insertionIndex} is out of range [0, ${track.clips.length}]`,
          ["payload", "insertionIndex"],
        ),
      };
    }
  }

  const start = toBig(clip.timelineStartUs);
  const end = start + toBig(durationUs);
  const conflict = findOverlapConflict(track.clips, start, end, undefined);
  if (conflict) {
    return {
      ok: false,
      error: makeError(
        "OVERLAP",
        `clip overlaps existing clip ${conflict.id} on track ${trackId}`,
        ["payload", "clip", "timelineStartUs"],
        { conflictClipId: conflict.id },
      ),
    };
  }

  const fullClip: TimelineClip = {
    id: clip.id,
    assetId: clip.assetId,
    trackId: track.id,
    timelineStartUs: clip.timelineStartUs,
    timelineDurationUs: durationUs,
    sourceInUs: clip.sourceInUs,
    sourceOutUs: clip.sourceOutUs,
    playbackRate: { numerator: 1, denominator: 1 },
    audioGainDb: 0,
    audioPan: 0,
    effects: [],
  };

  const newClips =
    insertionIndex !== undefined
      ? [
          ...track.clips.slice(0, insertionIndex),
          fullClip,
          ...track.clips.slice(insertionIndex),
        ]
      : sortClips([...track.clips, fullClip]);

  const prevUpdatedAt = project.updatedAt;
  const nextSequence = replaceTrack(sequence, { ...track, clips: newClips });
  const next: Project = {
    ...project,
    sequences: replaceSequence(project, nextSequence),
    updatedAt: command.createdAt,
    currentVersion: project.currentVersion + 1,
  };
  return {
    ok: true,
    project: next,
    inverse: {
      commandType: "internal.remove_clip",
      payload: {
        sequenceId,
        trackId: track.id,
        clipId: clip.id,
        restoreUpdatedAt: prevUpdatedAt,
      },
    },
  };
}

function moveClip(
  projectOrNull: Project | null,
  command: Extract<ProjectCommand, { commandType: "timeline.move_clip" }>,
): ForwardResult {
  const pre = requireLiveProject(projectOrNull, command.baseVersion);
  if (!pre.ok) return pre;
  const project = pre.project;
  const { sequenceId, clipId, targetTrackId, timelineStartUs } =
    command.payload;

  const sequence = findSequence(project, sequenceId);
  if (sequence === undefined) {
    return {
      ok: false,
      error: makeError(
        "SEQUENCE_NOT_FOUND",
        `sequence ${sequenceId} not found`,
        ["payload", "sequenceId"],
      ),
    };
  }
  const location = locateClip(sequence, clipId);
  if (location === undefined) {
    return {
      ok: false,
      error: makeError("CLIP_NOT_FOUND", `clip ${clipId} not found`, [
        "payload",
        "clipId",
      ]),
    };
  }
  const targetTrack = sequence.tracks.find((t) => t.id === targetTrackId);
  if (targetTrack === undefined) {
    return {
      ok: false,
      error: makeError("TRACK_NOT_FOUND", `track ${targetTrackId} not found`, [
        "payload",
        "targetTrackId",
      ]),
    };
  }
  const asset = findAsset(project, location.clip.assetId);
  if (asset === undefined) {
    return {
      ok: false,
      error: makeError(
        "ASSET_NOT_FOUND",
        `asset ${location.clip.assetId} not found`,
        ["payload", "clipId"],
      ),
    };
  }
  if (!isAssetCompatibleWithTrack(targetTrack.kind, asset.kind)) {
    return {
      ok: false,
      error: makeError(
        "INCOMPATIBLE_TRACK",
        `asset kind ${asset.kind} is not compatible with a ${targetTrack.kind} track`,
        ["payload", "targetTrackId"],
        { trackKind: targetTrack.kind, assetKind: asset.kind },
      ),
    };
  }

  const start = toBig(timelineStartUs);
  const end = start + toBig(location.clip.timelineDurationUs);
  const conflict = findOverlapConflict(
    targetTrack.clips,
    start,
    end,
    location.clip.transitionIn,
    clipId,
  );
  if (conflict) {
    return {
      ok: false,
      error: makeError(
        "OVERLAP",
        `moved clip overlaps existing clip ${conflict.id} on track ${targetTrackId}`,
        ["payload", "timelineStartUs"],
        { conflictClipId: conflict.id },
      ),
    };
  }

  const sourceTrack = location.track;
  const movedClip: TimelineClip = {
    ...location.clip,
    trackId: targetTrack.id,
    timelineStartUs,
  };

  const nextTracks = sequence.tracks.map((t) => {
    if (sourceTrack.id === targetTrack.id) {
      if (t.id === targetTrack.id) {
        const remaining = t.clips.filter((c) => c.id !== clipId);
        return { ...t, clips: sortClips([...remaining, movedClip]) };
      }
      return t;
    }
    if (t.id === sourceTrack.id) {
      return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
    }
    if (t.id === targetTrack.id) {
      return { ...t, clips: sortClips([...t.clips, movedClip]) };
    }
    return t;
  });

  const prevUpdatedAt = project.updatedAt;
  const nextSequence: Sequence = { ...sequence, tracks: nextTracks };
  const next: Project = {
    ...project,
    sequences: replaceSequence(project, nextSequence),
    updatedAt: command.createdAt,
    currentVersion: project.currentVersion + 1,
  };
  return {
    ok: true,
    project: next,
    inverse: {
      commandType: "internal.move_clip",
      payload: {
        sequenceId,
        clipId,
        targetTrackId: sourceTrack.id,
        timelineStartUs: location.clip.timelineStartUs,
        insertionIndex: location.clipIndex,
        restoreUpdatedAt: prevUpdatedAt,
      },
    },
  };
}

function trimClip(
  projectOrNull: Project | null,
  command: Extract<ProjectCommand, { commandType: "timeline.trim_clip" }>,
): ForwardResult {
  const pre = requireLiveProject(projectOrNull, command.baseVersion);
  if (!pre.ok) return pre;
  const project = pre.project;
  const { sequenceId, clipId, sourceInUs, sourceOutUs } = command.payload;

  const sequence = findSequence(project, sequenceId);
  if (sequence === undefined) {
    return {
      ok: false,
      error: makeError(
        "SEQUENCE_NOT_FOUND",
        `sequence ${sequenceId} not found`,
        ["payload", "sequenceId"],
      ),
    };
  }
  const location = locateClip(sequence, clipId);
  if (location === undefined) {
    return {
      ok: false,
      error: makeError("CLIP_NOT_FOUND", `clip ${clipId} not found`, [
        "payload",
        "clipId",
      ]),
    };
  }
  const asset = findAsset(project, location.clip.assetId);
  if (asset === undefined) {
    return {
      ok: false,
      error: makeError(
        "ASSET_NOT_FOUND",
        `asset ${location.clip.assetId} not found`,
        ["payload", "clipId"],
      ),
    };
  }

  const rangeError = validateSourceRange(asset, sourceInUs, sourceOutUs, [
    "payload",
  ]);
  if (rangeError) return { ok: false, error: rangeError };

  const newDuration = toBig(sourceOutUs) - toBig(sourceInUs);
  const oldDuration = toBig(location.clip.timelineDurationUs);

  const strandedKeyframe = location.clip.animations
    ?.flatMap((track) => track.keyframes)
    .find((keyframe) => toBig(keyframe.timeUs) > newDuration);
  if (strandedKeyframe !== undefined) {
    return {
      ok: false,
      error: makeError(
        "OUT_OF_BOUNDS",
        `trimmed duration ${newDuration} would strand keyframe ${strandedKeyframe.id} at ${strandedKeyframe.timeUs}`,
        ["payload", "sourceOutUs"],
        {
          keyframeId: strandedKeyframe.id,
          keyframeTimeUs: strandedKeyframe.timeUs,
          durationUs: newDuration.toString(),
        },
      ),
    };
  }

  if (newDuration > oldDuration) {
    const start = toBig(location.clip.timelineStartUs);
    const end = start + newDuration;
    const conflict = findOverlapConflict(
      location.track.clips,
      start,
      end,
      location.clip.transitionIn,
      clipId,
    );
    if (conflict) {
      return {
        ok: false,
        error: makeError(
          "OVERLAP",
          `trimmed clip overlaps existing clip ${conflict.id}`,
          ["payload", "sourceOutUs"],
          { conflictClipId: conflict.id },
        ),
      };
    }
  }

  const updatedClip: TimelineClip = {
    ...location.clip,
    sourceInUs,
    sourceOutUs,
    timelineDurationUs: newDuration.toString(),
  };
  const nextTrack: Track = {
    ...location.track,
    clips: location.track.clips.map((c) => (c.id === clipId ? updatedClip : c)),
  };

  const prevUpdatedAt = project.updatedAt;
  const nextSequence = replaceTrack(sequence, nextTrack);
  const next: Project = {
    ...project,
    sequences: replaceSequence(project, nextSequence),
    updatedAt: command.createdAt,
    currentVersion: project.currentVersion + 1,
  };
  return {
    ok: true,
    project: next,
    inverse: {
      commandType: "internal.set_clip_source",
      payload: {
        sequenceId,
        clipId,
        sourceInUs: location.clip.sourceInUs,
        sourceOutUs: location.clip.sourceOutUs,
        restoreUpdatedAt: prevUpdatedAt,
      },
    },
  };
}

function deleteClip(
  projectOrNull: Project | null,
  command: Extract<ProjectCommand, { commandType: "timeline.delete_clip" }>,
): ForwardResult {
  const pre = requireLiveProject(projectOrNull, command.baseVersion);
  if (!pre.ok) return pre;
  const project = pre.project;
  const { sequenceId, clipId } = command.payload;

  const sequence = findSequence(project, sequenceId);
  if (sequence === undefined) {
    return {
      ok: false,
      error: makeError(
        "SEQUENCE_NOT_FOUND",
        `sequence ${sequenceId} not found`,
        ["payload", "sequenceId"],
      ),
    };
  }
  const location = locateClip(sequence, clipId);
  if (location === undefined) {
    return {
      ok: false,
      error: makeError("CLIP_NOT_FOUND", `clip ${clipId} not found`, [
        "payload",
        "clipId",
      ]),
    };
  }

  const nextTrack: Track = {
    ...location.track,
    clips: location.track.clips.filter((c) => c.id !== clipId),
  };

  const prevUpdatedAt = project.updatedAt;
  const nextSequence = replaceTrack(sequence, nextTrack);
  const next: Project = {
    ...project,
    sequences: replaceSequence(project, nextSequence),
    updatedAt: command.createdAt,
    currentVersion: project.currentVersion + 1,
  };
  return {
    ok: true,
    project: next,
    inverse: {
      commandType: "internal.insert_clip",
      payload: {
        sequenceId,
        trackId: location.track.id,
        clip: structuredClone(location.clip),
        insertionIndex: location.clipIndex,
        restoreUpdatedAt: prevUpdatedAt,
      },
    },
  };
}

// --- effect reducers --------------------------------------------------------

interface ResolvedClip {
  sequence: Sequence;
  location: ClipLocation;
}

/** Existence checks (2,3,4) common to every effect command. */
function resolveClip(
  projectOrNull: Project | null,
  baseVersion: number,
  sequenceId: string,
  clipId: string,
):
  | { ok: false; error: CommandError }
  | { ok: true; project: Project; resolved: ResolvedClip } {
  const pre = requireLiveProject(projectOrNull, baseVersion);
  if (!pre.ok) return pre;
  const project = pre.project;
  const sequence = findSequence(project, sequenceId);
  if (sequence === undefined) {
    return {
      ok: false,
      error: makeError(
        "SEQUENCE_NOT_FOUND",
        `sequence ${sequenceId} not found`,
        ["payload", "sequenceId"],
      ),
    };
  }
  const location = locateClip(sequence, clipId);
  if (location === undefined) {
    return {
      ok: false,
      error: makeError("CLIP_NOT_FOUND", `clip ${clipId} not found`, [
        "payload",
        "clipId",
      ]),
    };
  }
  return { ok: true, project, resolved: { sequence, location } };
}

/** Commit a changed clip: bump version and set `updatedAt` to the command time. */
function commitClipChange(
  project: Project,
  sequence: Sequence,
  track: Track,
  newClip: TimelineClip,
  createdAt: string,
): Project {
  const nextTrack: Track = {
    ...track,
    clips: track.clips.map((c) => (c.id === newClip.id ? newClip : c)),
  };
  return {
    ...project,
    sequences: replaceSequence(project, replaceTrack(sequence, nextTrack)),
    updatedAt: createdAt,
    currentVersion: project.currentVersion + 1,
  };
}

function addEffect(
  projectOrNull: Project | null,
  command: Extract<ProjectCommand, { commandType: "timeline.add_effect" }>,
): ForwardResult {
  const { sequenceId, clipId, effect } = command.payload;
  const resolved = resolveClip(
    projectOrNull,
    command.baseVersion,
    sequenceId,
    clipId,
  );
  if (!resolved.ok) return resolved;
  const { project } = resolved;
  const { sequence, location } = resolved.resolved;

  if (location.clip.effects.some((e) => e.id === effect.id)) {
    return {
      ok: false,
      error: makeError(
        "DUPLICATE_ID",
        `effect id ${effect.id} already exists`,
        ["payload", "effect", "id"],
      ),
    };
  }

  const prevUpdatedAt = project.updatedAt;
  const newClip: TimelineClip = {
    ...location.clip,
    effects: [...location.clip.effects, structuredClone(effect)],
  };
  return {
    ok: true,
    project: commitClipChange(
      project,
      sequence,
      location.track,
      newClip,
      command.createdAt,
    ),
    inverse: {
      commandType: "internal.remove_effect",
      payload: {
        sequenceId,
        clipId,
        effectId: effect.id,
        restoreUpdatedAt: prevUpdatedAt,
      },
    },
  };
}

function updateEffectParams(
  projectOrNull: Project | null,
  command: Extract<
    ProjectCommand,
    { commandType: "timeline.update_effect_params" }
  >,
): ForwardResult {
  const { sequenceId, clipId, effectId, params } = command.payload;
  const resolved = resolveClip(
    projectOrNull,
    command.baseVersion,
    sequenceId,
    clipId,
  );
  if (!resolved.ok) return resolved;
  const { project } = resolved;
  const { sequence, location } = resolved.resolved;

  const effect = location.clip.effects.find((e) => e.id === effectId);
  if (effect === undefined) {
    return {
      ok: false,
      error: makeError("EFFECT_NOT_FOUND", `effect ${effectId} not found`, [
        "payload",
        "effectId",
      ]),
    };
  }

  // New params are validated against the existing effect's type.
  const parsed = effectParamsSchemas[effect.type].safeParse(params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: makeError(
        "VALIDATION_ERROR",
        issue ? issue.message : "invalid effect params",
        ["payload", "params", ...(issue ? issue.path : [])],
      ),
    };
  }

  const prevUpdatedAt = project.updatedAt;
  const updatedEffect = {
    ...effect,
    params: parsed.data,
  } as EffectInstance;
  const newClip: TimelineClip = {
    ...location.clip,
    effects: location.clip.effects.map((e) =>
      e.id === effectId ? updatedEffect : e,
    ),
  };
  return {
    ok: true,
    project: commitClipChange(
      project,
      sequence,
      location.track,
      newClip,
      command.createdAt,
    ),
    inverse: {
      commandType: "internal.set_effect_params",
      payload: {
        sequenceId,
        clipId,
        effectId,
        params: structuredClone(effect.params),
        restoreUpdatedAt: prevUpdatedAt,
      },
    },
  };
}

function removeEffect(
  projectOrNull: Project | null,
  command: Extract<ProjectCommand, { commandType: "timeline.remove_effect" }>,
): ForwardResult {
  const { sequenceId, clipId, effectId } = command.payload;
  const resolved = resolveClip(
    projectOrNull,
    command.baseVersion,
    sequenceId,
    clipId,
  );
  if (!resolved.ok) return resolved;
  const { project } = resolved;
  const { sequence, location } = resolved.resolved;

  const index = location.clip.effects.findIndex((e) => e.id === effectId);
  if (index < 0) {
    return {
      ok: false,
      error: makeError("EFFECT_NOT_FOUND", `effect ${effectId} not found`, [
        "payload",
        "effectId",
      ]),
    };
  }
  const removed = location.clip.effects[index]!;

  const prevUpdatedAt = project.updatedAt;
  const newClip: TimelineClip = {
    ...location.clip,
    effects: location.clip.effects.filter((e) => e.id !== effectId),
  };
  return {
    ok: true,
    project: commitClipChange(
      project,
      sequence,
      location.track,
      newClip,
      command.createdAt,
    ),
    inverse: {
      commandType: "internal.insert_effect",
      payload: {
        sequenceId,
        clipId,
        effect: structuredClone(removed),
        insertionIndex: index,
        restoreUpdatedAt: prevUpdatedAt,
      },
    },
  };
}

function reorderEffects(
  projectOrNull: Project | null,
  command: Extract<ProjectCommand, { commandType: "timeline.reorder_effects" }>,
): ForwardResult {
  const { sequenceId, clipId, order } = command.payload;
  const resolved = resolveClip(
    projectOrNull,
    command.baseVersion,
    sequenceId,
    clipId,
  );
  if (!resolved.ok) return resolved;
  const { project } = resolved;
  const { sequence, location } = resolved.resolved;
  const effects = location.clip.effects;

  const seen = new Set<string>();
  for (const id of order) {
    if (seen.has(id)) {
      return {
        ok: false,
        error: makeError("DUPLICATE_ID", `duplicate effect id ${id} in order`, [
          "payload",
          "order",
        ]),
      };
    }
    seen.add(id);
    if (!effects.some((e) => e.id === id)) {
      return {
        ok: false,
        error: makeError("EFFECT_NOT_FOUND", `effect ${id} not found`, [
          "payload",
          "order",
        ]),
      };
    }
  }
  if (order.length !== effects.length) {
    return {
      ok: false,
      error: makeError(
        "VALIDATION_ERROR",
        "order must include every effect exactly once",
        ["payload", "order"],
      ),
    };
  }

  const prevOrder = effects.map((e) => e.id);
  const reordered = order.map((id) => effects.find((e) => e.id === id)!);

  const prevUpdatedAt = project.updatedAt;
  const newClip: TimelineClip = { ...location.clip, effects: reordered };
  return {
    ok: true,
    project: commitClipChange(
      project,
      sequence,
      location.track,
      newClip,
      command.createdAt,
    ),
    inverse: {
      commandType: "internal.reorder_effects",
      payload: {
        sequenceId,
        clipId,
        order: prevOrder,
        restoreUpdatedAt: prevUpdatedAt,
      },
    },
  };
}

function updateClipEffects(
  projectOrNull: Project | null,
  command: Extract<
    ProjectCommand,
    { commandType: "timeline.update_clip_effects" }
  >,
): ForwardResult {
  const { sequenceId, clipId, effects } = command.payload;
  const resolved = resolveClip(
    projectOrNull,
    command.baseVersion,
    sequenceId,
    clipId,
  );
  if (!resolved.ok) return resolved;
  const { project } = resolved;
  const { sequence, location } = resolved.resolved;

  const seen = new Set<string>();
  for (const effect of effects) {
    if (seen.has(effect.id)) {
      return {
        ok: false,
        error: makeError("DUPLICATE_ID", `duplicate effect id ${effect.id}`, [
          "payload",
          "effects",
        ]),
      };
    }
    seen.add(effect.id);
  }

  const prevUpdatedAt = project.updatedAt;
  const prevEffects = location.clip.effects;
  const newClip: TimelineClip = {
    ...location.clip,
    effects: structuredClone(effects),
  };
  return {
    ok: true,
    project: commitClipChange(
      project,
      sequence,
      location.track,
      newClip,
      command.createdAt,
    ),
    inverse: {
      commandType: "internal.set_clip_effects",
      payload: {
        sequenceId,
        clipId,
        effects: structuredClone(prevEffects),
        restoreUpdatedAt: prevUpdatedAt,
      },
    },
  };
}

// --- animation keyframe reducers -------------------------------------------

function sortAnimationKeyframes(
  keyframes: readonly AnimationKeyframe[],
): AnimationKeyframe[] {
  return [...keyframes].sort((a, b) => {
    const aTime = toBig(a.timeUs);
    const bTime = toBig(b.timeUs);
    if (aTime < bTime) return -1;
    if (aTime > bTime) return 1;
    return compareIds(a.id, b.id);
  });
}

function setAnimationTracks(
  clip: TimelineClip,
  animations: readonly AnimationTrack[],
): TimelineClip {
  if (animations.length === 0) {
    const withoutAnimations: TimelineClip = { ...clip };
    delete withoutAnimations.animations;
    return withoutAnimations;
  }
  return { ...clip, animations: structuredClone([...animations]) };
}

function previousAnimationTracks(clip: TimelineClip): AnimationTrack[] | null {
  return clip.animations === undefined
    ? null
    : structuredClone(clip.animations);
}

function validateKeyframeTime(
  clip: TimelineClip,
  timeUs: string,
  path: Array<string | number>,
): CommandError | null {
  if (toBig(timeUs) > toBig(clip.timelineDurationUs)) {
    return makeError(
      "OUT_OF_BOUNDS",
      `keyframe time ${timeUs} exceeds clip duration ${clip.timelineDurationUs}`,
      path,
      { durationUs: clip.timelineDurationUs },
    );
  }
  return null;
}

function validateAnimationTrack(
  track: AnimationTrack,
): { ok: true; track: AnimationTrack } | { ok: false; error: CommandError } {
  const parsed = animationTrackSchema.safeParse(track);
  if (parsed.success) return { ok: true, track: parsed.data };
  const issue = parsed.error.issues[0];
  return {
    ok: false,
    error: makeError(
      "VALIDATION_ERROR",
      issue?.message ?? "invalid animation track",
      ["payload", ...(issue?.path ?? [])],
    ),
  };
}

function addKeyframe(
  projectOrNull: Project | null,
  command: Extract<ProjectCommand, { commandType: "timeline.add_keyframe" }>,
): ForwardResult {
  const { sequenceId, clipId, animationId, property, keyframe } =
    command.payload;
  const resolved = resolveClip(
    projectOrNull,
    command.baseVersion,
    sequenceId,
    clipId,
  );
  if (!resolved.ok) return resolved;
  const { project } = resolved;
  const { sequence, location } = resolved.resolved;
  const animations = location.clip.animations ?? [];

  const timeError = validateKeyframeTime(location.clip, keyframe.timeUs, [
    "payload",
    "keyframe",
    "timeUs",
  ]);
  if (timeError) return { ok: false, error: timeError };

  if (
    animations.some((track) =>
      track.keyframes.some((existing) => existing.id === keyframe.id),
    )
  ) {
    return {
      ok: false,
      error: makeError(
        "DUPLICATE_ID",
        `keyframe id ${keyframe.id} already exists`,
        ["payload", "keyframe", "id"],
      ),
    };
  }

  const trackById = animations.find((track) => track.id === animationId);
  const trackByProperty = animations.find(
    (track) => track.property === property,
  );
  if (trackById !== undefined && trackById.property !== property) {
    return {
      ok: false,
      error: makeError(
        "DUPLICATE_ID",
        `animation id ${animationId} already belongs to ${trackById.property}`,
        ["payload", "animationId"],
      ),
    };
  }
  if (trackByProperty !== undefined && trackByProperty.id !== animationId) {
    return {
      ok: false,
      error: makeError(
        "DUPLICATE_ID",
        `property ${property} is already animated by ${trackByProperty.id}`,
        ["payload", "property"],
      ),
    };
  }

  const candidate: AnimationTrack = trackById
    ? {
        ...trackById,
        keyframes: sortAnimationKeyframes([
          ...trackById.keyframes,
          structuredClone(keyframe),
        ]),
      }
    : {
        id: animationId,
        property,
        keyframes: [structuredClone(keyframe)],
      };
  const validated = validateAnimationTrack(candidate);
  if (!validated.ok) return validated;

  const nextAnimations = trackById
    ? animations.map((track) =>
        track.id === animationId ? validated.track : track,
      )
    : [...animations, validated.track];
  const prevUpdatedAt = project.updatedAt;
  const newClip = setAnimationTracks(location.clip, nextAnimations);
  return {
    ok: true,
    project: commitClipChange(
      project,
      sequence,
      location.track,
      newClip,
      command.createdAt,
    ),
    inverse: {
      commandType: "internal.set_clip_animations",
      payload: {
        sequenceId,
        clipId,
        animations: previousAnimationTracks(location.clip),
        restoreUpdatedAt: prevUpdatedAt,
      },
    },
  };
}

function updateKeyframe(
  projectOrNull: Project | null,
  command: Extract<ProjectCommand, { commandType: "timeline.update_keyframe" }>,
): ForwardResult {
  const { sequenceId, clipId, animationId, keyframeId, timeUs, value, easing } =
    command.payload;
  const resolved = resolveClip(
    projectOrNull,
    command.baseVersion,
    sequenceId,
    clipId,
  );
  if (!resolved.ok) return resolved;
  const { project } = resolved;
  const { sequence, location } = resolved.resolved;
  const animations = location.clip.animations ?? [];
  const track = animations.find((item) => item.id === animationId);
  if (track === undefined) {
    return {
      ok: false,
      error: makeError(
        "ANIMATION_TRACK_NOT_FOUND",
        `animation track ${animationId} not found`,
        ["payload", "animationId"],
      ),
    };
  }
  if (!track.keyframes.some((keyframe) => keyframe.id === keyframeId)) {
    return {
      ok: false,
      error: makeError(
        "KEYFRAME_NOT_FOUND",
        `keyframe ${keyframeId} not found`,
        ["payload", "keyframeId"],
      ),
    };
  }

  const timeError = validateKeyframeTime(location.clip, timeUs, [
    "payload",
    "timeUs",
  ]);
  if (timeError) return { ok: false, error: timeError };

  const candidate: AnimationTrack = {
    ...track,
    keyframes: sortAnimationKeyframes(
      track.keyframes.map((keyframe) =>
        keyframe.id === keyframeId
          ? { ...keyframe, timeUs, value, easing }
          : keyframe,
      ),
    ),
  };
  const validated = validateAnimationTrack(candidate);
  if (!validated.ok) return validated;

  const prevUpdatedAt = project.updatedAt;
  const nextAnimations = animations.map((item) =>
    item.id === animationId ? validated.track : item,
  );
  const newClip = setAnimationTracks(location.clip, nextAnimations);
  return {
    ok: true,
    project: commitClipChange(
      project,
      sequence,
      location.track,
      newClip,
      command.createdAt,
    ),
    inverse: {
      commandType: "internal.set_clip_animations",
      payload: {
        sequenceId,
        clipId,
        animations: previousAnimationTracks(location.clip),
        restoreUpdatedAt: prevUpdatedAt,
      },
    },
  };
}

function removeKeyframe(
  projectOrNull: Project | null,
  command: Extract<ProjectCommand, { commandType: "timeline.remove_keyframe" }>,
): ForwardResult {
  const { sequenceId, clipId, animationId, keyframeId } = command.payload;
  const resolved = resolveClip(
    projectOrNull,
    command.baseVersion,
    sequenceId,
    clipId,
  );
  if (!resolved.ok) return resolved;
  const { project } = resolved;
  const { sequence, location } = resolved.resolved;
  const animations = location.clip.animations ?? [];
  const track = animations.find((item) => item.id === animationId);
  if (track === undefined) {
    return {
      ok: false,
      error: makeError(
        "ANIMATION_TRACK_NOT_FOUND",
        `animation track ${animationId} not found`,
        ["payload", "animationId"],
      ),
    };
  }
  if (!track.keyframes.some((keyframe) => keyframe.id === keyframeId)) {
    return {
      ok: false,
      error: makeError(
        "KEYFRAME_NOT_FOUND",
        `keyframe ${keyframeId} not found`,
        ["payload", "keyframeId"],
      ),
    };
  }

  const remainingKeyframes = track.keyframes.filter(
    (keyframe) => keyframe.id !== keyframeId,
  );
  const nextAnimations =
    remainingKeyframes.length === 0
      ? animations.filter((item) => item.id !== animationId)
      : animations.map((item) =>
          item.id === animationId
            ? { ...item, keyframes: remainingKeyframes }
            : item,
        );
  const prevUpdatedAt = project.updatedAt;
  const newClip = setAnimationTracks(location.clip, nextAnimations);
  return {
    ok: true,
    project: commitClipChange(
      project,
      sequence,
      location.track,
      newClip,
      command.createdAt,
    ),
    inverse: {
      commandType: "internal.set_clip_animations",
      payload: {
        sequenceId,
        clipId,
        animations: previousAnimationTracks(location.clip),
        restoreUpdatedAt: prevUpdatedAt,
      },
    },
  };
}

function updateClipAnimations(
  projectOrNull: Project | null,
  command: Extract<
    ProjectCommand,
    { commandType: "timeline.update_clip_animations" }
  >,
): ForwardResult {
  const { sequenceId, clipId, animations } = command.payload;
  const resolved = resolveClip(
    projectOrNull,
    command.baseVersion,
    sequenceId,
    clipId,
  );
  if (!resolved.ok) return resolved;
  const { project } = resolved;
  const { sequence, location } = resolved.resolved;

  for (let trackIndex = 0; trackIndex < animations.length; trackIndex++) {
    const track = animations[trackIndex]!;
    for (
      let keyframeIndex = 0;
      keyframeIndex < track.keyframes.length;
      keyframeIndex++
    ) {
      const keyframe = track.keyframes[keyframeIndex]!;
      const timeError = validateKeyframeTime(location.clip, keyframe.timeUs, [
        "payload",
        "animations",
        trackIndex,
        "keyframes",
        keyframeIndex,
        "timeUs",
      ]);
      if (timeError) return { ok: false, error: timeError };
    }
  }

  const prevUpdatedAt = project.updatedAt;
  const newClip = setAnimationTracks(location.clip, animations);
  return {
    ok: true,
    project: commitClipChange(
      project,
      sequence,
      location.track,
      newClip,
      command.createdAt,
    ),
    inverse: {
      commandType: "internal.set_clip_animations",
      payload: {
        sequenceId,
        clipId,
        animations: previousAnimationTracks(location.clip),
        restoreUpdatedAt: prevUpdatedAt,
      },
    },
  };
}

/** `null` clears the given end. The cross-field rule that both ramps must fit
 * inside the clip lives here rather than in the clip schema, because
 * command-schema derives payloads from that schema with `.omit()` and a
 * `superRefine` would turn it into a ZodEffects. */
function setClipTransition(
  projectOrNull: Project | null,
  command: Extract<
    ProjectCommand,
    { commandType: "timeline.set_clip_transition" }
  >,
): ForwardResult {
  const { sequenceId, clipId, side, transition } = command.payload;
  const resolved = resolveClip(
    projectOrNull,
    command.baseVersion,
    sequenceId,
    clipId,
  );
  if (!resolved.ok) return resolved;
  const { project } = resolved;
  const { sequence, location } = resolved.resolved;
  const clip = location.clip;

  const nextIn = side === "in" ? transition : (clip.transitionIn ?? null);
  const nextOut = side === "out" ? transition : (clip.transitionOut ?? null);
  if (
    !transitionsFitClip(
      clip.timelineDurationUs,
      nextIn?.durationUs,
      nextOut?.durationUs,
    )
  ) {
    return {
      ok: false,
      error: makeError(
        "TRANSITION_TOO_LONG",
        "transitionIn + transitionOut cannot exceed the clip duration",
        ["payload", "transition", "durationUs"],
        {
          clipDurationUs: clip.timelineDurationUs,
          transitionInUs: nextIn?.durationUs ?? null,
          transitionOutUs: nextOut?.durationUs ?? null,
        },
      ),
    };
  }

  // Shrinking or clearing an incoming crossfade can strand an overlap that
  // only existed because that crossfade covered it.
  const start = toBig(clip.timelineStartUs);
  const conflict = findOverlapConflict(
    location.track.clips,
    start,
    start + toBig(clip.timelineDurationUs),
    nextIn ?? undefined,
    clip.id,
  );
  if (conflict) {
    return {
      ok: false,
      error: makeError(
        "OVERLAP",
        `clip overlaps ${conflict.id}; that overlap is only legal while an incoming crossfade covers it`,
        ["payload", "transition"],
        { conflictClipId: conflict.id },
      ),
    };
  }

  const prevUpdatedAt = project.updatedAt;
  return {
    ok: true,
    project: commitClipChange(
      project,
      sequence,
      location.track,
      withTransition(clip, side, transition),
      command.createdAt,
    ),
    inverse: {
      commandType: "internal.set_clip_transition",
      payload: {
        sequenceId,
        clipId,
        side,
        transition: previousTransition(clip, side),
        restoreUpdatedAt: prevUpdatedAt,
      },
    },
  };
}

function withTransition(
  clip: TimelineClip,
  side: TransitionSide,
  transition: Transition | null,
): TimelineClip {
  const key = side === "in" ? "transitionIn" : "transitionOut";
  if (transition === null) {
    const without: TimelineClip = { ...clip };
    delete without[key];
    return without;
  }
  return { ...clip, [key]: structuredClone(transition) };
}

function previousTransition(
  clip: TimelineClip,
  side: TransitionSide,
): Transition | null {
  const current = side === "in" ? clip.transitionIn : clip.transitionOut;
  return current === undefined ? null : structuredClone(current);
}

// --- audio reducers ---------------------------------------------------------

function setClipAudioGain(
  projectOrNull: Project | null,
  command: Extract<
    ProjectCommand,
    { commandType: "timeline.set_clip_audio_gain" }
  >,
): ForwardResult {
  const { sequenceId, clipId, gainDb } = command.payload;
  const resolved = resolveClip(
    projectOrNull,
    command.baseVersion,
    sequenceId,
    clipId,
  );
  if (!resolved.ok) return resolved;
  const { project } = resolved;
  const { sequence, location } = resolved.resolved;

  const prevUpdatedAt = project.updatedAt;
  const prevGain = location.clip.audioGainDb;
  const newClip: TimelineClip = { ...location.clip, audioGainDb: gainDb };
  return {
    ok: true,
    project: commitClipChange(
      project,
      sequence,
      location.track,
      newClip,
      command.createdAt,
    ),
    inverse: {
      commandType: "internal.set_clip_audio_gain",
      payload: {
        sequenceId,
        clipId,
        gainDb: prevGain,
        restoreUpdatedAt: prevUpdatedAt,
      },
    },
  };
}

function setClipAudioPan(
  projectOrNull: Project | null,
  command: Extract<
    ProjectCommand,
    { commandType: "timeline.set_clip_audio_pan" }
  >,
): ForwardResult {
  const { sequenceId, clipId, pan } = command.payload;
  const resolved = resolveClip(
    projectOrNull,
    command.baseVersion,
    sequenceId,
    clipId,
  );
  if (!resolved.ok) return resolved;
  const { project } = resolved;
  const { sequence, location } = resolved.resolved;

  const prevUpdatedAt = project.updatedAt;
  const prevPan = location.clip.audioPan;
  const newClip: TimelineClip = { ...location.clip, audioPan: pan };
  return {
    ok: true,
    project: commitClipChange(
      project,
      sequence,
      location.track,
      newClip,
      command.createdAt,
    ),
    inverse: {
      commandType: "internal.set_clip_audio_pan",
      payload: {
        sequenceId,
        clipId,
        pan: prevPan,
        restoreUpdatedAt: prevUpdatedAt,
      },
    },
  };
}

/**
 * Retime a clip.
 *
 * The source range is left alone — speed decides how the same frames are spread
 * over the timeline — so the new timeline duration is
 * `(sourceOut - sourceIn) * denominator / numerator`. That division truncates
 * toward zero at sub-microsecond precision, which is why the inverse carries the
 * previous duration verbatim rather than recomputing it: recomputing would
 * repeat the truncation and undo would not restore the original bytes.
 */
function setClipSpeed(
  projectOrNull: Project | null,
  command: Extract<ProjectCommand, { commandType: "timeline.set_clip_speed" }>,
): ForwardResult {
  const { sequenceId, clipId, playbackRate } = command.payload;
  const resolved = resolveClip(
    projectOrNull,
    command.baseVersion,
    sequenceId,
    clipId,
  );
  if (!resolved.ok) return resolved;
  const { project } = resolved;
  const { sequence, location } = resolved.resolved;
  const clip = location.clip;

  const sourceSpan = toBig(clip.sourceOutUs) - toBig(clip.sourceInUs);
  const newDuration =
    (sourceSpan * BigInt(playbackRate.denominator)) /
    BigInt(playbackRate.numerator);
  if (newDuration <= 0n) {
    return {
      ok: false,
      error: makeError(
        "INVALID_TIME_RANGE",
        "the retimed clip would have no duration",
        ["payload", "playbackRate"],
      ),
    };
  }

  const oldDuration = toBig(clip.timelineDurationUs);
  const start = toBig(clip.timelineStartUs);

  if (newDuration > oldDuration) {
    const conflict = findOverlapConflict(
      location.track.clips,
      start,
      start + newDuration,
      clip.transitionIn,
      clipId,
    );
    if (conflict) {
      return {
        ok: false,
        error: makeError(
          "OVERLAP",
          `the retimed clip overlaps existing clip ${conflict.id}`,
          ["payload", "playbackRate"],
          { conflictClipId: conflict.id },
        ),
      };
    }
  }

  // Keyframes are authored in clip-local time, so a clip that gets shorter can
  // strand them past its own end — the same rule trimming already enforces.
  const strandedKeyframe = clip.animations
    ?.flatMap((track) => track.keyframes)
    .find((keyframe) => toBig(keyframe.timeUs) > newDuration);
  if (strandedKeyframe !== undefined) {
    return {
      ok: false,
      error: makeError(
        "OUT_OF_BOUNDS",
        `retimed duration ${newDuration} would strand keyframe ${strandedKeyframe.id} at ${strandedKeyframe.timeUs}`,
        ["payload", "playbackRate"],
        {
          keyframeId: strandedKeyframe.id,
          keyframeTimeUs: strandedKeyframe.timeUs,
          durationUs: newDuration.toString(),
        },
      ),
    };
  }

  const prevUpdatedAt = project.updatedAt;
  const newClip: TimelineClip = {
    ...clip,
    playbackRate,
    timelineDurationUs: newDuration.toString(),
  };
  return {
    ok: true,
    project: commitClipChange(
      project,
      sequence,
      location.track,
      newClip,
      command.createdAt,
    ),
    inverse: {
      commandType: "internal.set_clip_speed",
      payload: {
        sequenceId,
        clipId,
        playbackRate: clip.playbackRate,
        timelineDurationUs: clip.timelineDurationUs,
        restoreUpdatedAt: prevUpdatedAt,
      },
    },
  };
}

// --- masks ------------------------------------------------------------------
//
// Every mask command's inverse restores the clip's whole mask list. The list is
// small geometry, so carrying it entire buys exact undo — including the
// difference between "no masks" and "an empty list", which canonical JSON
// treats as different projects — without a reconstruction rule per command.

function withMasks(clip: TimelineClip, masks: ClipMask[] | null): TimelineClip {
  if (masks === null || masks.length === 0) {
    const { masks: _dropped, ...rest } = clip;
    return rest as TimelineClip;
  }
  return { ...clip, masks };
}

function maskInverse(
  sequenceId: string,
  clipId: string,
  clip: TimelineClip,
  restoreUpdatedAt: string,
): ProjectOperation["inverse"] {
  return {
    commandType: "internal.set_clip_masks",
    payload: {
      sequenceId,
      clipId,
      masks: clip.masks ? structuredClone(clip.masks) : null,
      restoreUpdatedAt,
    },
  };
}

function addMask(
  projectOrNull: Project | null,
  command: Extract<ProjectCommand, { commandType: "timeline.add_mask" }>,
): ForwardResult {
  const { sequenceId, clipId, mask } = command.payload;
  const resolved = resolveClip(
    projectOrNull,
    command.baseVersion,
    sequenceId,
    clipId,
  );
  if (!resolved.ok) return resolved;
  const { project } = resolved;
  const { sequence, location } = resolved.resolved;
  const clip = location.clip;

  if ((clip.masks ?? []).some((existing) => existing.id === mask.id)) {
    return {
      ok: false,
      error: makeError("DUPLICATE_ID", `mask ${mask.id} already exists`, [
        "payload",
        "mask",
        "id",
      ]),
    };
  }

  const prevUpdatedAt = project.updatedAt;
  const next = withMasks(clip, [...(clip.masks ?? []), structuredClone(mask)]);
  return {
    ok: true,
    project: commitClipChange(
      project,
      sequence,
      location.track,
      next,
      command.createdAt,
    ),
    inverse: maskInverse(sequenceId, clipId, clip, prevUpdatedAt),
  };
}

function updateMask(
  projectOrNull: Project | null,
  command: Extract<ProjectCommand, { commandType: "timeline.update_mask" }>,
): ForwardResult {
  const { sequenceId, clipId, maskId, contributions, name } = command.payload;
  const resolved = resolveClip(
    projectOrNull,
    command.baseVersion,
    sequenceId,
    clipId,
  );
  if (!resolved.ok) return resolved;
  const { project } = resolved;
  const { sequence, location } = resolved.resolved;
  const clip = location.clip;

  const existing = (clip.masks ?? []).find((m) => m.id === maskId);
  if (existing === undefined) {
    return {
      ok: false,
      error: makeError("MASK_NOT_FOUND", `mask ${maskId} not found`, [
        "payload",
        "maskId",
      ]),
    };
  }

  const prevUpdatedAt = project.updatedAt;
  const updated: ClipMask = {
    ...existing,
    ...(name === undefined ? {} : { name }),
    contributions: structuredClone(contributions),
  };
  const next = withMasks(
    clip,
    (clip.masks ?? []).map((m) => (m.id === maskId ? updated : m)),
  );
  return {
    ok: true,
    project: commitClipChange(
      project,
      sequence,
      location.track,
      next,
      command.createdAt,
    ),
    inverse: maskInverse(sequenceId, clipId, clip, prevUpdatedAt),
  };
}

function removeMask(
  projectOrNull: Project | null,
  command: Extract<ProjectCommand, { commandType: "timeline.remove_mask" }>,
): ForwardResult {
  const { sequenceId, clipId, maskId } = command.payload;
  const resolved = resolveClip(
    projectOrNull,
    command.baseVersion,
    sequenceId,
    clipId,
  );
  if (!resolved.ok) return resolved;
  const { project } = resolved;
  const { sequence, location } = resolved.resolved;
  const clip = location.clip;

  if (!(clip.masks ?? []).some((m) => m.id === maskId)) {
    return {
      ok: false,
      error: makeError("MASK_NOT_FOUND", `mask ${maskId} not found`, [
        "payload",
        "maskId",
      ]),
    };
  }

  // Deleting a mask an effect points at would leave a dangling reference that
  // renders as "not masked" — the adjustment would silently go global.
  const user = clip.effects.find((effect) => effect.maskId === maskId);
  if (user !== undefined) {
    return {
      ok: false,
      error: makeError(
        "MASK_IN_USE",
        `mask ${maskId} is still used by effect ${user.id}`,
        ["payload", "maskId"],
        { effectId: user.id },
      ),
    };
  }

  const prevUpdatedAt = project.updatedAt;
  const next = withMasks(
    clip,
    (clip.masks ?? []).filter((m) => m.id !== maskId),
  );
  return {
    ok: true,
    project: commitClipChange(
      project,
      sequence,
      location.track,
      next,
      command.createdAt,
    ),
    inverse: maskInverse(sequenceId, clipId, clip, prevUpdatedAt),
  };
}

function setEffectMask(
  projectOrNull: Project | null,
  command: Extract<ProjectCommand, { commandType: "timeline.set_effect_mask" }>,
): ForwardResult {
  const { sequenceId, clipId, effectId, maskId } = command.payload;
  const resolved = resolveClip(
    projectOrNull,
    command.baseVersion,
    sequenceId,
    clipId,
  );
  if (!resolved.ok) return resolved;
  const { project } = resolved;
  const { sequence, location } = resolved.resolved;
  const clip = location.clip;

  const effect = clip.effects.find((e) => e.id === effectId);
  if (effect === undefined) {
    return {
      ok: false,
      error: makeError("EFFECT_NOT_FOUND", `effect ${effectId} not found`, [
        "payload",
        "effectId",
      ]),
    };
  }
  if (maskId !== null && !(clip.masks ?? []).some((m) => m.id === maskId)) {
    return {
      ok: false,
      error: makeError("MASK_NOT_FOUND", `mask ${maskId} not found`, [
        "payload",
        "maskId",
      ]),
    };
  }

  const prevUpdatedAt = project.updatedAt;
  const prevMaskId = effect.maskId ?? null;
  const nextEffects = clip.effects.map((e) => {
    if (e.id !== effectId) return e;
    if (maskId === null) {
      const { maskId: _cleared, ...rest } = e;
      return rest as typeof e;
    }
    return { ...e, maskId };
  });
  return {
    ok: true,
    project: commitClipChange(
      project,
      sequence,
      location.track,
      { ...clip, effects: nextEffects },
      command.createdAt,
    ),
    inverse: {
      commandType: "internal.set_effect_mask",
      payload: {
        sequenceId,
        clipId,
        effectId,
        maskId: prevMaskId,
        restoreUpdatedAt: prevUpdatedAt,
      },
    },
  };
}

// --- shared validation ------------------------------------------------------

function validateSourceRange(
  asset: MediaAsset,
  sourceInUs: string,
  sourceOutUs: string,
  basePath: Array<string | number>,
): CommandError | null {
  const inU = toBig(sourceInUs);
  const outU = toBig(sourceOutUs);
  if (!(inU < outU)) {
    return makeError(
      "INVALID_TIME_RANGE",
      "sourceOutUs must be strictly greater than sourceInUs",
      [...basePath, "sourceOutUs"],
    );
  }
  const durationUs = asset.metadata.durationUs;
  if (durationUs === undefined) {
    return makeError(
      "INVALID_TIME_RANGE",
      `asset ${asset.id} has no durationUs; a clip cannot reference an asset without a duration`,
      [...basePath, "sourceOutUs"],
      { assetId: asset.id },
    );
  }
  if (outU > toBig(durationUs)) {
    return makeError(
      "INVALID_TIME_RANGE",
      `source range exceeds asset duration ${durationUs}`,
      [...basePath, "sourceOutUs"],
      { assetId: asset.id, durationUs },
    );
  }
  return null;
}

function replaceTrack(sequence: Sequence, track: Track): Sequence {
  return {
    ...sequence,
    tracks: sequence.tracks.map((t) => (t.id === track.id ? track : t)),
  };
}

// --- inverse application (undo) ---------------------------------------------

/** Apply an internal inverse command. Returns the restored project (or `null`
 * when undoing `project.create`). Sets `updatedAt` from the inverse payload;
 * the caller sets `currentVersion`. */
export function applyInverse(
  project: Project | null,
  inverse: InternalProjectCommand,
): Project | null {
  switch (inverse.commandType) {
    case "internal.remove_project":
      return null;
    case "internal.remove_asset": {
      const p = requireProject(project);
      return {
        ...p,
        assets: p.assets.filter((a) => a.id !== inverse.payload.assetId),
        updatedAt: inverse.payload.restoreUpdatedAt,
      };
    }
    case "internal.set_asset_rating": {
      const p = requireProject(project);
      const asset = findAsset(p, inverse.payload.assetId);
      if (asset === undefined) {
        throw new Error(
          `inverse rating references missing asset ${inverse.payload.assetId}`,
        );
      }
      return {
        ...p,
        assets: p.assets.map((candidate) =>
          candidate.id === inverse.payload.assetId
            ? withAssetRating(candidate, inverse.payload.rating)
            : candidate,
        ),
        updatedAt: inverse.payload.restoreUpdatedAt,
      };
    }
    case "internal.remove_sequence": {
      const p = requireProject(project);
      return {
        ...p,
        sequences: p.sequences.filter(
          (s) => s.id !== inverse.payload.sequenceId,
        ),
        updatedAt: inverse.payload.restoreUpdatedAt,
      };
    }
    case "internal.remove_track": {
      const p = requireProject(project);
      const seq = mustSequence(p, inverse.payload.sequenceId);
      const nextSeq: Sequence = {
        ...seq,
        tracks: seq.tracks.filter((t) => t.id !== inverse.payload.trackId),
      };
      return withSequence(p, nextSeq, inverse.payload.restoreUpdatedAt);
    }
    case "internal.remove_clip": {
      const p = requireProject(project);
      const seq = mustSequence(p, inverse.payload.sequenceId);
      const nextSeq = mapTrack(seq, inverse.payload.trackId, (track) => ({
        ...track,
        clips: track.clips.filter((c) => c.id !== inverse.payload.clipId),
      }));
      return withSequence(p, nextSeq, inverse.payload.restoreUpdatedAt);
    }
    case "internal.insert_clip": {
      const p = requireProject(project);
      const seq = mustSequence(p, inverse.payload.sequenceId);
      const { clip, insertionIndex } = inverse.payload;
      const nextSeq = mapTrack(seq, inverse.payload.trackId, (track) => ({
        ...track,
        clips: [
          ...track.clips.slice(0, insertionIndex),
          structuredClone(clip),
          ...track.clips.slice(insertionIndex),
        ],
      }));
      return withSequence(p, nextSeq, inverse.payload.restoreUpdatedAt);
    }
    case "internal.move_clip": {
      const p = requireProject(project);
      const seq = mustSequence(p, inverse.payload.sequenceId);
      const location = locateClip(seq, inverse.payload.clipId);
      if (location === undefined) {
        throw new Error(
          `inverse move references missing clip ${inverse.payload.clipId}`,
        );
      }
      const moved: TimelineClip = {
        ...location.clip,
        trackId: inverse.payload.targetTrackId,
        timelineStartUs: inverse.payload.timelineStartUs,
      };
      const { targetTrackId, insertionIndex } = inverse.payload;
      const sourceTrackId = location.track.id;
      const nextTracks = seq.tracks.map((t) => {
        if (sourceTrackId === targetTrackId) {
          if (t.id === targetTrackId) {
            const remaining = t.clips.filter(
              (c) => c.id !== inverse.payload.clipId,
            );
            return {
              ...t,
              clips: [
                ...remaining.slice(0, insertionIndex),
                moved,
                ...remaining.slice(insertionIndex),
              ],
            };
          }
          return t;
        }
        if (t.id === sourceTrackId) {
          return {
            ...t,
            clips: t.clips.filter((c) => c.id !== inverse.payload.clipId),
          };
        }
        if (t.id === targetTrackId) {
          return {
            ...t,
            clips: [
              ...t.clips.slice(0, insertionIndex),
              moved,
              ...t.clips.slice(insertionIndex),
            ],
          };
        }
        return t;
      });
      return withSequence(
        p,
        { ...seq, tracks: nextTracks },
        inverse.payload.restoreUpdatedAt,
      );
    }
    case "internal.set_clip_source": {
      const p = requireProject(project);
      const seq = mustSequence(p, inverse.payload.sequenceId);
      const location = locateClip(seq, inverse.payload.clipId);
      if (location === undefined) {
        throw new Error(
          `inverse trim references missing clip ${inverse.payload.clipId}`,
        );
      }
      const newDuration = (
        toBig(inverse.payload.sourceOutUs) - toBig(inverse.payload.sourceInUs)
      ).toString();
      const updated: TimelineClip = {
        ...location.clip,
        sourceInUs: inverse.payload.sourceInUs,
        sourceOutUs: inverse.payload.sourceOutUs,
        timelineDurationUs: newDuration,
      };
      const nextSeq = mapTrack(seq, location.track.id, (track) => ({
        ...track,
        clips: track.clips.map((c) =>
          c.id === inverse.payload.clipId ? updated : c,
        ),
      }));
      return withSequence(p, nextSeq, inverse.payload.restoreUpdatedAt);
    }
    case "internal.remove_effect": {
      const { sequenceId, clipId, effectId, restoreUpdatedAt } =
        inverse.payload;
      return mapClip(project, sequenceId, clipId, restoreUpdatedAt, (clip) => ({
        ...clip,
        effects: clip.effects.filter((e) => e.id !== effectId),
      }));
    }
    case "internal.insert_effect": {
      const { sequenceId, clipId, effect, insertionIndex, restoreUpdatedAt } =
        inverse.payload;
      return mapClip(project, sequenceId, clipId, restoreUpdatedAt, (clip) => ({
        ...clip,
        effects: [
          ...clip.effects.slice(0, insertionIndex),
          structuredClone(effect),
          ...clip.effects.slice(insertionIndex),
        ],
      }));
    }
    case "internal.set_effect_params": {
      const { sequenceId, clipId, effectId, params, restoreUpdatedAt } =
        inverse.payload;
      return mapClip(project, sequenceId, clipId, restoreUpdatedAt, (clip) => ({
        ...clip,
        effects: clip.effects.map((e) =>
          e.id === effectId
            ? ({ ...e, params: structuredClone(params) } as EffectInstance)
            : e,
        ),
      }));
    }
    case "internal.reorder_effects": {
      const { sequenceId, clipId, order, restoreUpdatedAt } = inverse.payload;
      return mapClip(project, sequenceId, clipId, restoreUpdatedAt, (clip) => ({
        ...clip,
        effects: order.map((id) => {
          const found = clip.effects.find((e) => e.id === id);
          if (found === undefined) {
            throw new Error(`inverse reorder references missing effect ${id}`);
          }
          return found;
        }),
      }));
    }
    case "internal.set_clip_effects": {
      const { sequenceId, clipId, effects, restoreUpdatedAt } = inverse.payload;
      return mapClip(project, sequenceId, clipId, restoreUpdatedAt, (clip) => ({
        ...clip,
        effects: structuredClone(effects),
      }));
    }
    case "internal.set_clip_audio_gain": {
      const { sequenceId, clipId, gainDb, restoreUpdatedAt } = inverse.payload;
      return mapClip(project, sequenceId, clipId, restoreUpdatedAt, (clip) => ({
        ...clip,
        audioGainDb: gainDb,
      }));
    }
    case "internal.set_clip_audio_pan": {
      const { sequenceId, clipId, pan, restoreUpdatedAt } = inverse.payload;
      return mapClip(project, sequenceId, clipId, restoreUpdatedAt, (clip) => ({
        ...clip,
        audioPan: pan,
      }));
    }
    case "internal.set_clip_speed": {
      const {
        sequenceId,
        clipId,
        playbackRate,
        timelineDurationUs,
        restoreUpdatedAt,
      } = inverse.payload;
      return mapClip(project, sequenceId, clipId, restoreUpdatedAt, (clip) => ({
        ...clip,
        playbackRate,
        timelineDurationUs,
      }));
    }
    case "internal.set_clip_masks": {
      const { sequenceId, clipId, masks, restoreUpdatedAt } = inverse.payload;
      return mapClip(project, sequenceId, clipId, restoreUpdatedAt, (clip) =>
        masks === null
          ? ((): TimelineClip => {
              const { masks: _dropped, ...rest } = clip;
              return rest as TimelineClip;
            })()
          : { ...clip, masks: structuredClone(masks) },
      );
    }
    case "internal.set_effect_mask": {
      const { sequenceId, clipId, effectId, maskId, restoreUpdatedAt } =
        inverse.payload;
      return mapClip(project, sequenceId, clipId, restoreUpdatedAt, (clip) => ({
        ...clip,
        effects: clip.effects.map((effect) => {
          if (effect.id !== effectId) return effect;
          if (maskId === null) {
            const { maskId: _cleared, ...rest } = effect;
            return rest as typeof effect;
          }
          return { ...effect, maskId };
        }),
      }));
    }
    case "internal.set_clip_animations": {
      const { sequenceId, clipId, animations, restoreUpdatedAt } =
        inverse.payload;
      return mapClip(project, sequenceId, clipId, restoreUpdatedAt, (clip) =>
        animations === null
          ? setAnimationTracks(clip, [])
          : { ...clip, animations: structuredClone(animations) },
      );
    }
    case "internal.set_clip_transition": {
      const { sequenceId, clipId, side, transition, restoreUpdatedAt } =
        inverse.payload;
      return mapClip(project, sequenceId, clipId, restoreUpdatedAt, (clip) =>
        withTransition(clip, side, transition),
      );
    }
    default:
      throw new Error("unknown internal command");
  }
}

/** Apply a pure transform to one clip, restoring `updatedAt`. Used by effect
 * inverses. Throws on missing entities (indicates corruption, not a domain
 * failure). */
function mapClip(
  project: Project | null,
  sequenceId: string,
  clipId: string,
  updatedAt: string,
  transform: (clip: TimelineClip) => TimelineClip,
): Project {
  const p = requireProject(project);
  const seq = mustSequence(p, sequenceId);
  const location = locateClip(seq, clipId);
  if (location === undefined) {
    throw new Error(`inverse references missing clip ${clipId}`);
  }
  const nextSeq = mapTrack(seq, location.track.id, (track) => ({
    ...track,
    clips: track.clips.map((c) => (c.id === clipId ? transform(c) : c)),
  }));
  return withSequence(p, nextSeq, updatedAt);
}

function requireProject(project: Project | null): Project {
  if (project === null) {
    throw new Error("cannot apply inverse to a null project");
  }
  return project;
}

function mustSequence(project: Project, sequenceId: string): Sequence {
  const seq = findSequence(project, sequenceId);
  if (seq === undefined) {
    throw new Error(`inverse references missing sequence ${sequenceId}`);
  }
  return seq;
}

function mapTrack(
  sequence: Sequence,
  trackId: string,
  fn: (track: Track) => Track,
): Sequence {
  return {
    ...sequence,
    tracks: sequence.tracks.map((t) => (t.id === trackId ? fn(t) : t)),
  };
}

function withSequence(
  project: Project,
  sequence: Sequence,
  updatedAt: string,
): Project {
  return {
    ...project,
    sequences: replaceSequence(project, sequence),
    updatedAt,
  };
}
