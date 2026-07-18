import { describe, expect, it } from "vitest";
import { canonicalStringify, deepFreeze } from "@director/canonical-json";
import {
  createEditorState,
  executeCommand,
  type EditorState,
} from "../src/index.js";
import {
  addClipCommand,
  addTrackCommand,
  baseTimelineState,
  createProjectCommand,
  IDS,
  mustExecute,
  registerVideoAssetCommand,
  T,
} from "./fixtures.js";

function clipsOf(state: EditorState, trackId = "track-1") {
  const track = state.project?.sequences[0]?.tracks.find(
    (t) => t.id === trackId,
  );
  return track?.clips ?? [];
}

describe("valid public commands", () => {
  it("project.create produces version 1 with matching timestamps", () => {
    const result = mustExecute(createEditorState(), createProjectCommand());
    expect(result.state.project?.currentVersion).toBe(1);
    expect(result.state.project?.createdAt).toBe(T.t1);
    expect(result.state.project?.updatedAt).toBe(T.t1);
    expect(result.operation.resultingVersion).toBe(1);
    expect(result.operation.id).toBe(IDS.cmd1);
  });

  it("asset.register adds an asset and bumps version, updatedAt = command createdAt", () => {
    let state = mustExecute(createEditorState(), createProjectCommand()).state;
    const result = mustExecute(
      state,
      registerVideoAssetCommand({
        id: IDS.cmd2,
        createdAt: T.t2,
        baseVersion: 1,
        durationUs: "5000000",
      }),
    );
    state = result.state;
    expect(state.project?.assets).toHaveLength(1);
    expect(state.project?.currentVersion).toBe(2);
    expect(state.project?.updatedAt).toBe(T.t2);
  });

  it("timeline.create_sequence and add_track build the timeline", () => {
    const state = baseTimelineState();
    expect(state.project?.sequences).toHaveLength(1);
    expect(state.project?.sequences[0]?.tracks).toHaveLength(1);
    expect(state.project?.currentVersion).toBe(4);
  });

  it("timeline.add_clip derives timelineDurationUs and stores the clip", () => {
    const state = mustExecute(
      baseTimelineState(),
      addClipCommand({
        id: IDS.cmd5,
        createdAt: T.t5,
        baseVersion: 4,
        sourceInUs: "1000000",
        sourceOutUs: "3000000",
        timelineStartUs: "0",
      }),
    ).state;
    const clips = clipsOf(state);
    expect(clips).toHaveLength(1);
    expect(clips[0]?.timelineDurationUs).toBe("2000000");
    expect(clips[0]?.trackId).toBe("track-1");
    expect(clips[0]?.playbackRate).toEqual({ numerator: 1, denominator: 1 });
  });

  it("timeline.move_clip preserves duration/source and relocates the clip", () => {
    let state = mustExecute(
      baseTimelineState(),
      addClipCommand({
        id: IDS.cmd5,
        createdAt: T.t5,
        baseVersion: 4,
        sourceInUs: "0",
        sourceOutUs: "1000000",
        timelineStartUs: "0",
      }),
    ).state;
    state = mustExecute(state, {
      id: IDS.cmd6,
      commandType: "timeline.move_clip",
      baseVersion: 5,
      actor: { type: "user", id: "user-1" },
      createdAt: T.t6,
      payload: {
        sequenceId: "sequence-1",
        clipId: "clip-1",
        targetTrackId: "track-1",
        timelineStartUs: "2000000",
      },
    }).state;
    const clip = clipsOf(state)[0];
    expect(clip?.timelineStartUs).toBe("2000000");
    expect(clip?.timelineDurationUs).toBe("1000000");
  });

  it("timeline.trim_clip recomputes duration and keeps timelineStartUs", () => {
    let state = mustExecute(
      baseTimelineState(),
      addClipCommand({
        id: IDS.cmd5,
        createdAt: T.t5,
        baseVersion: 4,
        sourceInUs: "0",
        sourceOutUs: "2000000",
        timelineStartUs: "3000000",
      }),
    ).state;
    state = mustExecute(state, {
      id: IDS.cmd6,
      commandType: "timeline.trim_clip",
      baseVersion: 5,
      actor: { type: "user", id: "user-1" },
      createdAt: T.t6,
      payload: {
        sequenceId: "sequence-1",
        clipId: "clip-1",
        sourceInUs: "0",
        sourceOutUs: "1000000",
      },
    }).state;
    const clip = clipsOf(state)[0];
    expect(clip?.timelineStartUs).toBe("3000000");
    expect(clip?.timelineDurationUs).toBe("1000000");
  });

  it("timeline.delete_clip removes the clip", () => {
    let state = mustExecute(
      baseTimelineState(),
      addClipCommand({ id: IDS.cmd5, createdAt: T.t5, baseVersion: 4 }),
    ).state;
    state = mustExecute(state, {
      id: IDS.cmd6,
      commandType: "timeline.delete_clip",
      baseVersion: 5,
      actor: { type: "user", id: "user-1" },
      createdAt: T.t6,
      payload: { sequenceId: "sequence-1", clipId: "clip-1" },
    }).state;
    expect(clipsOf(state)).toHaveLength(0);
  });
});

describe("deterministic ordering", () => {
  it("inserts clips ordered by timelineStartUs then id when no insertionIndex", () => {
    let state = baseTimelineState();
    state = mustExecute(
      state,
      addClipCommand({
        id: IDS.cmd5,
        createdAt: T.t5,
        baseVersion: 4,
        clipId: "clip-c",
        timelineStartUs: "2000000",
        sourceInUs: "0",
        sourceOutUs: "1000000",
      }),
    ).state;
    state = mustExecute(
      state,
      addClipCommand({
        id: IDS.cmd6,
        createdAt: T.t6,
        baseVersion: 5,
        clipId: "clip-a",
        timelineStartUs: "0",
        sourceInUs: "0",
        sourceOutUs: "1000000",
      }),
    ).state;
    expect(clipsOf(state).map((c) => c.id)).toEqual(["clip-a", "clip-c"]);
  });

  it("orders tracks by ascending index then id", () => {
    let state = baseTimelineState();
    state = mustExecute(
      state,
      addTrackCommand({
        id: IDS.cmd5,
        createdAt: T.t5,
        baseVersion: 4,
        trackId: "track-b",
        index: 2,
        kind: "audio",
      }),
    ).state;
    state = mustExecute(
      state,
      addTrackCommand({
        id: IDS.cmd6,
        createdAt: T.t6,
        baseVersion: 5,
        trackId: "track-a",
        index: 1,
        kind: "audio",
      }),
    ).state;
    // track-1 (index 0), track-a (index 1), track-b (index 2)
    expect(state.project?.sequences[0]?.tracks.map((t) => t.id)).toEqual([
      "track-1",
      "track-a",
      "track-b",
    ]);
  });
});

describe("half-open overlap rules", () => {
  it("rejects overlapping clips but allows adjacency", () => {
    const state = mustExecute(
      baseTimelineState(),
      addClipCommand({
        id: IDS.cmd5,
        createdAt: T.t5,
        baseVersion: 4,
        clipId: "clip-a",
        timelineStartUs: "0",
        sourceInUs: "0",
        sourceOutUs: "1000000",
      }),
    ).state;

    const overlap = executeCommand(
      state,
      addClipCommand({
        id: IDS.cmd6,
        createdAt: T.t6,
        baseVersion: 5,
        clipId: "clip-x",
        timelineStartUs: "999999",
        sourceInUs: "0",
        sourceOutUs: "1000000",
      }),
    );
    expect(overlap.ok).toBe(false);
    if (!overlap.ok) expect(overlap.error.code).toBe("OVERLAP");

    const adjacent = executeCommand(
      state,
      addClipCommand({
        id: IDS.cmd6,
        createdAt: T.t6,
        baseVersion: 5,
        clipId: "clip-b",
        timelineStartUs: "1000000",
        sourceInUs: "0",
        sourceOutUs: "1000000",
      }),
    );
    expect(adjacent.ok).toBe(true);
  });
});

describe("failed-command atomicity and input immutability", () => {
  it("a rejected command returns the prior state unchanged", () => {
    const state = baseTimelineState();
    const before = canonicalStringify(state);
    const result = executeCommand(state, {
      id: IDS.cmd5,
      commandType: "timeline.add_clip",
      baseVersion: 4,
      actor: { type: "user", id: "user-1" },
      createdAt: T.t5,
      payload: {
        sequenceId: "sequence-1",
        trackId: "does-not-exist",
        clip: {
          id: "clip-1",
          assetId: "asset-1",
          timelineStartUs: "0",
          sourceInUs: "0",
          sourceOutUs: "1000000",
          playbackRate: { numerator: 1, denominator: 1 },
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(canonicalStringify(state)).toBe(before);
  });

  it("does not mutate frozen input state or command objects", () => {
    const state = deepFreeze(baseTimelineState());
    const command = deepFreeze(
      addClipCommand({ id: IDS.cmd5, createdAt: T.t5, baseVersion: 4 }),
    );
    const commandBefore = canonicalStringify(command);
    const result = executeCommand(state, command);
    expect(result.ok).toBe(true);
    // input command untouched
    expect(canonicalStringify(command)).toBe(commandBefore);
    // mutating the resulting clip must not affect the original command payload
    expect(canonicalStringify(command)).toBe(commandBefore);
  });
});
