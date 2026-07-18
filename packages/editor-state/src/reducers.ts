import {
  effectParamsSchemas,
  isAssetCompatibleWithTrack,
  type EffectInstance,
  type MediaAsset,
  type Project,
  type Sequence,
  type TimelineClip,
  type Track,
} from "@director/project-schema";
import type {
  InternalProjectCommand,
  ProjectCommand,
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
  const oStart = toBig(other.timelineStartUs);
  const oEnd = oStart + toBig(other.timelineDurationUs);
  return aStart < oEnd && oStart < aEnd;
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
    case "timeline.set_clip_audio_gain":
      return setClipAudioGain(project, command);
    case "timeline.set_clip_audio_pan":
      return setClipAudioPan(project, command);
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
  const conflict = track.clips.find((c) => overlaps(start, end, c));
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
  const conflict = targetTrack.clips.find(
    (c) => c.id !== clipId && overlaps(start, end, c),
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

  if (newDuration > oldDuration) {
    const start = toBig(location.clip.timelineStartUs);
    const end = start + newDuration;
    const conflict = location.track.clips.find(
      (c) => c.id !== clipId && overlaps(start, end, c),
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
