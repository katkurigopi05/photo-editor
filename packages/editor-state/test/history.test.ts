import { describe, expect, it } from "vitest";
import { canonicalStringify } from "@director/canonical-json";
import type { ProjectCommand } from "@director/command-schema";
import {
  createEditorState,
  executeCommand,
  redo,
  undo,
  type EditorState,
} from "../src/index.js";
import {
  addClipCommand,
  baseTimelineState,
  createProjectCommand,
  IDS,
  mustExecute,
  T,
} from "./fixtures.js";

const USER = { type: "user", id: "user-1" } as const;

/**
 * Execute, then undo and redo.
 *
 * After undo, `project`, `operationLog`, and `undoStack` return to the prior
 * values; the undone operation moves onto `redoStack` (so the full state is not
 * identical to the pre-state, by design). After redo, the full state is exactly
 * the post-execute state again.
 */
function assertReversible(pre: EditorState, command: ProjectCommand) {
  const preProject = canonicalStringify(pre.project);
  const preLog = canonicalStringify(pre.operationLog);
  const exec = mustExecute(pre, command);
  const postCanon = canonicalStringify(exec.state);

  const undone = undo(exec.state);
  expect(undone.ok).toBe(true);
  if (!undone.ok) return;
  expect(canonicalStringify(undone.state.project)).toBe(preProject);
  expect(canonicalStringify(undone.state.operationLog)).toBe(preLog);
  expect(undone.state.operationLog).toEqual(undone.state.undoStack);
  expect(undone.state.redoStack).toHaveLength(pre.redoStack.length + 1);

  const redone = redo(undone.state);
  expect(redone.ok).toBe(true);
  if (!redone.ok) return;
  expect(canonicalStringify(redone.state)).toBe(postCanon);
}

describe("undo/redo for every command", () => {
  it("project.create", () => {
    assertReversible(createEditorState(), createProjectCommand());
  });

  it("asset.register", () => {
    const pre = mustExecute(createEditorState(), createProjectCommand()).state;
    assertReversible(pre, {
      id: IDS.cmd2,
      commandType: "asset.register",
      baseVersion: 1,
      actor: USER,
      createdAt: T.t2,
      payload: {
        asset: {
          id: "asset-1",
          projectId: "project-1",
          kind: "video",
          originalUri: "file:///a.mov",
          checksum:
            "0000000000000000000000000000000000000000000000000000000000000000",
          metadata: { fileSizeBytes: "1000", durationUs: "5000000" },
          createdAt: T.t2,
        },
      },
    });
  });

  it("timeline.add_clip", () => {
    assertReversible(
      baseTimelineState(),
      addClipCommand({ id: IDS.cmd5, createdAt: T.t5, baseVersion: 4 }),
    );
  });

  it("timeline.move_clip", () => {
    const pre = mustExecute(
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
    assertReversible(pre, {
      id: IDS.cmd6,
      commandType: "timeline.move_clip",
      baseVersion: 5,
      actor: USER,
      createdAt: T.t6,
      payload: {
        sequenceId: "sequence-1",
        clipId: "clip-1",
        targetTrackId: "track-1",
        timelineStartUs: "3000000",
      },
    });
  });

  it("timeline.trim_clip", () => {
    const pre = mustExecute(
      baseTimelineState(),
      addClipCommand({
        id: IDS.cmd5,
        createdAt: T.t5,
        baseVersion: 4,
        sourceInUs: "0",
        sourceOutUs: "2000000",
      }),
    ).state;
    assertReversible(pre, {
      id: IDS.cmd6,
      commandType: "timeline.trim_clip",
      baseVersion: 5,
      actor: USER,
      createdAt: T.t6,
      payload: {
        sequenceId: "sequence-1",
        clipId: "clip-1",
        sourceInUs: "0",
        sourceOutUs: "1000000",
      },
    });
  });

  it("timeline.delete_clip", () => {
    const pre = mustExecute(
      baseTimelineState(),
      addClipCommand({ id: IDS.cmd5, createdAt: T.t5, baseVersion: 4 }),
    ).state;
    assertReversible(pre, {
      id: IDS.cmd6,
      commandType: "timeline.delete_clip",
      baseVersion: 5,
      actor: USER,
      createdAt: T.t6,
      payload: { sequenceId: "sequence-1", clipId: "clip-1" },
    });
  });
});

describe("delete then undo restores exact order and values", () => {
  it("restores the deleted clip at its original array index", () => {
    let state = baseTimelineState();
    // three adjacent clips a, b, c
    state = mustExecute(
      state,
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
    state = mustExecute(
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
    ).state;
    state = mustExecute(
      state,
      addClipCommand({
        id: IDS.cmd7,
        createdAt: T.t7,
        baseVersion: 6,
        clipId: "clip-c",
        timelineStartUs: "2000000",
        sourceInUs: "0",
        sourceOutUs: "1000000",
      }),
    ).state;
    const beforeDeleteProject = canonicalStringify(state.project);

    const deleted = mustExecute(state, {
      id: IDS.cmd8,
      commandType: "timeline.delete_clip",
      baseVersion: 7,
      actor: USER,
      createdAt: T.t8,
      payload: { sequenceId: "sequence-1", clipId: "clip-b" },
    });
    const track = deleted.state.project?.sequences[0]?.tracks[0];
    expect(track?.clips.map((c) => c.id)).toEqual(["clip-a", "clip-c"]);

    const restored = undo(deleted.state);
    expect(restored.ok).toBe(true);
    expect(canonicalStringify(restored.state.project)).toBe(
      beforeDeleteProject,
    );
    const restoredTrack = restored.state.project?.sequences[0]?.tracks[0];
    expect(restoredTrack?.clips.map((c) => c.id)).toEqual([
      "clip-a",
      "clip-b",
      "clip-c",
    ]);
  });
});

describe("redo branch management", () => {
  it("a new successful command after undo clears the redo stack", () => {
    const exec = mustExecute(createEditorState(), createProjectCommand());
    const undone = undo(exec.state);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.state.redoStack).toHaveLength(1);

    // A fresh create is again valid at version 0.
    const again = executeCommand(undone.state, createProjectCommand());
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.state.redoStack).toHaveLength(0);
  });

  it("undoStack always mirrors operationLog", () => {
    const state = baseTimelineState();
    expect(state.undoStack).toEqual(state.operationLog);
  });
});

describe("empty history", () => {
  it("undo on empty history returns HISTORY_EMPTY", () => {
    const result = undo(createEditorState());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("HISTORY_EMPTY");
  });

  it("redo on empty history returns HISTORY_EMPTY", () => {
    const result = redo(createEditorState());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("HISTORY_EMPTY");
  });
});
