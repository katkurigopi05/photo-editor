import { describe, expect, it } from "vitest";
import { canonicalStringify } from "@director/canonical-json";
import type { ProjectCommand } from "@director/command-schema";
import {
  executeCommand,
  replay,
  undo,
  type CommandErrorCode,
  type EditorState,
  type ProjectOperation,
} from "../src/index.js";
import {
  addClipCommand,
  baseTimelineState,
  IDS,
  mustExecute,
  T,
} from "./fixtures.js";

const USER = { type: "user", id: "user-1" } as const;

function clipState(): EditorState {
  return mustExecute(
    baseTimelineState(),
    addClipCommand({ id: IDS.cmd5, createdAt: T.t5, baseVersion: 4 }),
  ).state;
}

function theClip(state: EditorState) {
  return state.project?.sequences[0]?.tracks[0]?.clips[0];
}

const gainCmd = (gainDb: number, baseVersion = 5): ProjectCommand =>
  ({
    id: IDS.cmd6,
    commandType: "timeline.set_clip_audio_gain",
    baseVersion,
    actor: USER,
    createdAt: T.t6,
    payload: { sequenceId: "sequence-1", clipId: "clip-1", gainDb },
  }) as ProjectCommand;

const panCmd = (pan: number, baseVersion = 5): ProjectCommand =>
  ({
    id: IDS.cmd6,
    commandType: "timeline.set_clip_audio_pan",
    baseVersion,
    actor: USER,
    createdAt: T.t6,
    payload: { sequenceId: "sequence-1", clipId: "clip-1", pan },
  }) as ProjectCommand;

describe("audio clip defaults", () => {
  it("a new clip is unity gain, center pan", () => {
    const clip = theClip(clipState());
    expect(clip?.audioGainDb).toBe(0);
    expect(clip?.audioPan).toBe(0);
  });
});

describe("set_clip_audio_gain", () => {
  it("sets gain and undo restores the prior value", () => {
    const state = clipState();
    const set = mustExecute(state, gainCmd(-6));
    expect(theClip(set.state)?.audioGainDb).toBe(-6);

    const undone = undo(set.state);
    expect(undone.ok).toBe(true);
    if (undone.ok) expect(theClip(undone.state)?.audioGainDb).toBe(0);
  });

  it("rejects out-of-range gain", () => {
    const result = executeCommand(clipState(), gainCmd(100));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe("VALIDATION_ERROR" as CommandErrorCode);
  });

  it("returns CLIP_NOT_FOUND for a missing clip", () => {
    const result = executeCommand(clipState(), {
      ...gainCmd(-3),
      payload: { sequenceId: "sequence-1", clipId: "ghost", gainDb: -3 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CLIP_NOT_FOUND");
  });
});

describe("set_clip_audio_pan", () => {
  it("sets pan and undo restores the prior value", () => {
    const state = clipState();
    const set = mustExecute(state, panCmd(0.5));
    expect(theClip(set.state)?.audioPan).toBe(0.5);

    const undone = undo(set.state);
    expect(undone.ok).toBe(true);
    if (undone.ok) expect(theClip(undone.state)?.audioPan).toBe(0);
  });

  it("rejects out-of-range pan", () => {
    const result = executeCommand(clipState(), panCmd(2));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("replay with audio commands", () => {
  it("replays byte-identically after a JSON round trip", () => {
    let state = clipState();
    const operations: ProjectOperation[] = [...state.operationLog];
    for (const cmd of [gainCmd(-3, 5), panCmd(-0.5, 6)]) {
      const r = mustExecute(state, cmd);
      operations.push(r.operation);
      state = r.state;
    }
    const result = replay(JSON.parse(JSON.stringify(operations)) as unknown[]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(canonicalStringify(result.state)).toBe(canonicalStringify(state));
    }
  });
});
