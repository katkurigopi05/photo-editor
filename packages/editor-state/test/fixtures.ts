import type { ProjectCommand } from "@director/command-schema";
import {
  createEditorState,
  executeCommand,
  type CommandResult,
  type EditorState,
} from "../src/index.js";

/**
 * Fixed IDs and timestamps. Reducers never read the clock or generate IDs, so
 * all identifying data is supplied here explicitly.
 */
export const IDS = {
  cmd1: "00000000-0000-4000-8000-000000000001",
  cmd2: "00000000-0000-4000-8000-000000000002",
  cmd3: "00000000-0000-4000-8000-000000000003",
  cmd4: "00000000-0000-4000-8000-000000000004",
  cmd5: "00000000-0000-4000-8000-000000000005",
  cmd6: "00000000-0000-4000-8000-000000000006",
  cmd7: "00000000-0000-4000-8000-000000000007",
  cmd8: "00000000-0000-4000-8000-000000000008",
} as const;

export const T = {
  t1: "2026-01-01T00:00:00.000Z",
  t2: "2026-01-02T00:00:00.000Z",
  t3: "2026-01-03T00:00:00.000Z",
  t4: "2026-01-04T00:00:00.000Z",
  t5: "2026-01-05T00:00:00.000Z",
  t6: "2026-01-06T00:00:00.000Z",
  t7: "2026-01-07T00:00:00.000Z",
  t8: "2026-01-08T00:00:00.000Z",
} as const;

export const CHECKSUM =
  "0000000000000000000000000000000000000000000000000000000000000000";

const USER = { type: "user", id: "user-1" } as const;

export function createProjectCommand(
  overrides: Partial<{ id: string; createdAt: string }> = {},
): ProjectCommand {
  return {
    id: overrides.id ?? IDS.cmd1,
    commandType: "project.create",
    baseVersion: 0,
    actor: USER,
    createdAt: overrides.createdAt ?? T.t1,
    payload: {
      projectId: "project-1",
      ownerId: "owner-1",
      name: "Demo Project",
      settings: { defaultFrameRate: { numerator: 30, denominator: 1 } },
    },
  };
}

export function registerVideoAssetCommand(opts: {
  id: string;
  createdAt: string;
  baseVersion: number;
  assetId?: string;
  durationUs?: string | undefined;
  projectId?: string;
}): ProjectCommand {
  const metadata: {
    fileSizeBytes: string;
    durationUs?: string;
    width: number;
    height: number;
    frameRate: { numerator: number; denominator: number };
  } = {
    fileSizeBytes: "1048576",
    width: 1920,
    height: 1080,
    frameRate: { numerator: 30, denominator: 1 },
  };
  if (opts.durationUs !== undefined) metadata.durationUs = opts.durationUs;
  return {
    id: opts.id,
    commandType: "asset.register",
    baseVersion: opts.baseVersion,
    actor: USER,
    createdAt: opts.createdAt,
    payload: {
      asset: {
        id: opts.assetId ?? "asset-1",
        projectId: opts.projectId ?? "project-1",
        kind: "video",
        originalUri: "file:///media/clip.mov",
        checksum: CHECKSUM,
        metadata,
        createdAt: opts.createdAt,
      },
    },
  };
}

export function createSequenceCommand(opts: {
  id: string;
  createdAt: string;
  baseVersion: number;
  sequenceId?: string;
}): ProjectCommand {
  return {
    id: opts.id,
    commandType: "timeline.create_sequence",
    baseVersion: opts.baseVersion,
    actor: USER,
    createdAt: opts.createdAt,
    payload: {
      sequence: {
        id: opts.sequenceId ?? "sequence-1",
        name: "Main",
        width: 1920,
        height: 1080,
        frameRate: { numerator: 30, denominator: 1 },
      },
    },
  };
}

export function addTrackCommand(opts: {
  id: string;
  createdAt: string;
  baseVersion: number;
  trackId?: string;
  index?: number;
  kind?: "video" | "audio";
  sequenceId?: string;
}): ProjectCommand {
  return {
    id: opts.id,
    commandType: "timeline.add_track",
    baseVersion: opts.baseVersion,
    actor: USER,
    createdAt: opts.createdAt,
    payload: {
      sequenceId: opts.sequenceId ?? "sequence-1",
      track: {
        id: opts.trackId ?? "track-1",
        kind: opts.kind ?? "video",
        name: "V1",
        index: opts.index ?? 0,
      },
    },
  };
}

export function addClipCommand(opts: {
  id: string;
  createdAt: string;
  baseVersion: number;
  clipId?: string;
  assetId?: string;
  trackId?: string;
  sequenceId?: string;
  timelineStartUs?: string;
  sourceInUs?: string;
  sourceOutUs?: string;
  insertionIndex?: number;
}): ProjectCommand {
  const payload: {
    sequenceId: string;
    trackId: string;
    clip: {
      id: string;
      assetId: string;
      timelineStartUs: string;
      sourceInUs: string;
      sourceOutUs: string;
      playbackRate: { numerator: 1; denominator: 1 };
    };
    insertionIndex?: number;
  } = {
    sequenceId: opts.sequenceId ?? "sequence-1",
    trackId: opts.trackId ?? "track-1",
    clip: {
      id: opts.clipId ?? "clip-1",
      assetId: opts.assetId ?? "asset-1",
      timelineStartUs: opts.timelineStartUs ?? "0",
      sourceInUs: opts.sourceInUs ?? "0",
      sourceOutUs: opts.sourceOutUs ?? "1000000",
      playbackRate: { numerator: 1, denominator: 1 },
    },
  };
  if (opts.insertionIndex !== undefined) {
    payload.insertionIndex = opts.insertionIndex;
  }
  return {
    id: opts.id,
    commandType: "timeline.add_clip",
    baseVersion: opts.baseVersion,
    actor: USER,
    createdAt: opts.createdAt,
    payload,
  };
}

/** Execute a command against a state, asserting success and returning it. */
export function mustExecute(
  state: EditorState,
  command: ProjectCommand,
): CommandResult & { ok: true } {
  const result = executeCommand(state, command);
  if (!result.ok) {
    throw new Error(
      `expected success but got ${result.error.code}: ${result.error.message}`,
    );
  }
  return result;
}

/**
 * Build a project with one video asset, one sequence, one video track, and one
 * clip. Returns the final state at version 4.
 */
export function baseTimelineState(): EditorState {
  let state = createEditorState();
  state = mustExecute(state, createProjectCommand()).state;
  state = mustExecute(
    state,
    registerVideoAssetCommand({
      id: IDS.cmd2,
      createdAt: T.t2,
      baseVersion: 1,
      durationUs: "5000000",
    }),
  ).state;
  state = mustExecute(
    state,
    createSequenceCommand({ id: IDS.cmd3, createdAt: T.t3, baseVersion: 2 }),
  ).state;
  state = mustExecute(
    state,
    addTrackCommand({ id: IDS.cmd4, createdAt: T.t4, baseVersion: 3 }),
  ).state;
  return state;
}
