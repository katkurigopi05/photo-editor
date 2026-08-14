import { describe, expect, it } from "vitest";
import { canonicalStringify } from "@director/canonical-json";
import type {
  ProjectCommand,
  ProjectOperation,
} from "@director/command-schema";
import {
  executeCommand,
  redo,
  replay,
  undo,
  type CommandErrorCode,
  type EditorState,
} from "../src/index.js";
import {
  addClipCommand,
  baseTimelineState,
  IDS,
  mustExecute,
  T,
} from "./fixtures.js";

const USER = { type: "user", id: "user-1" } as const;
const ANIMATION_ID = "animation-1";
const KEYFRAME_A = "keyframe-a";
const KEYFRAME_B = "keyframe-b";

function clipState(): EditorState {
  return mustExecute(
    baseTimelineState(),
    addClipCommand({ id: IDS.cmd5, createdAt: T.t5, baseVersion: 4 }),
  ).state;
}

function animationsOf(state: EditorState) {
  return state.project?.sequences[0]?.tracks[0]?.clips[0]?.animations;
}

function addKeyframeCommand(
  overrides: Partial<{
    id: string;
    baseVersion: number;
    createdAt: string;
    animationId: string;
    property: string;
    keyframeId: string;
    timeUs: string;
    value: number;
    easing: string;
    clipId: string;
    bezier: { x1: number; y1: number; x2: number; y2: number };
  }> = {},
): ProjectCommand {
  return {
    id: overrides.id ?? IDS.cmd6,
    commandType: "timeline.add_keyframe",
    baseVersion: overrides.baseVersion ?? 5,
    actor: USER,
    createdAt: overrides.createdAt ?? T.t6,
    payload: {
      sequenceId: "sequence-1",
      clipId: overrides.clipId ?? "clip-1",
      animationId: overrides.animationId ?? ANIMATION_ID,
      property: overrides.property ?? "transform.scale",
      keyframe: {
        id: overrides.keyframeId ?? KEYFRAME_A,
        timeUs: overrides.timeUs ?? "0",
        value: overrides.value ?? 1,
        easing: overrides.easing ?? "linear",
        ...(overrides.bezier ? { bezier: overrides.bezier } : {}),
      },
    },
  } as unknown as ProjectCommand;
}

function updateKeyframeCommand(
  overrides: Partial<{
    id: string;
    baseVersion: number;
    createdAt: string;
    animationId: string;
    keyframeId: string;
    timeUs: string;
    value: number;
    easing: string;
    bezier: { x1: number; y1: number; x2: number; y2: number };
  }> = {},
): ProjectCommand {
  return {
    id: overrides.id ?? IDS.cmd8,
    commandType: "timeline.update_keyframe",
    baseVersion: overrides.baseVersion ?? 7,
    actor: USER,
    createdAt: overrides.createdAt ?? T.t8,
    payload: {
      sequenceId: "sequence-1",
      clipId: "clip-1",
      animationId: overrides.animationId ?? ANIMATION_ID,
      keyframeId: overrides.keyframeId ?? KEYFRAME_A,
      timeUs: overrides.timeUs ?? "750000",
      value: overrides.value ?? 1.5,
      easing: overrides.easing ?? "ease-in-out",
      ...(overrides.bezier ? { bezier: overrides.bezier } : {}),
    },
  } as unknown as ProjectCommand;
}

function removeKeyframeCommand(baseVersion: number): ProjectCommand {
  return {
    id: "00000000-0000-4000-8000-000000000009",
    commandType: "timeline.remove_keyframe",
    baseVersion,
    actor: USER,
    createdAt: "2026-01-09T00:00:00.000Z",
    payload: {
      sequenceId: "sequence-1",
      clipId: "clip-1",
      animationId: ANIMATION_ID,
      keyframeId: KEYFRAME_A,
    },
  } as unknown as ProjectCommand;
}

function expectError(
  state: EditorState,
  command: ProjectCommand,
  code: CommandErrorCode,
): void {
  const before = canonicalStringify(state);
  const result = executeCommand(state, command);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
  expect(result.state).toBe(state);
  expect(canonicalStringify(state)).toBe(before);
}

describe("animation keyframe commands", () => {
  it("adds a first keyframe and materializes its animation track", () => {
    const result = mustExecute(clipState(), addKeyframeCommand());

    expect(animationsOf(result.state)).toEqual([
      {
        id: ANIMATION_ID,
        property: "transform.scale",
        keyframes: [
          {
            id: KEYFRAME_A,
            timeUs: "0",
            value: 1,
            easing: "linear",
          },
        ],
      },
    ]);
  });

  it("sorts added keyframes by canonical numeric time", () => {
    const first = mustExecute(
      clipState(),
      addKeyframeCommand({ timeUs: "900000" }),
    ).state;
    const second = mustExecute(
      first,
      addKeyframeCommand({
        id: IDS.cmd7,
        baseVersion: 6,
        createdAt: T.t7,
        keyframeId: KEYFRAME_B,
        timeUs: "100000",
        value: 1.2,
      }),
    ).state;

    expect(animationsOf(second)?.[0]?.keyframes.map((k) => k.timeUs)).toEqual([
      "100000",
      "900000",
    ]);
  });

  it("updates a keyframe and supports byte-exact undo and redo", () => {
    const first = mustExecute(clipState(), addKeyframeCommand()).state;
    const second = mustExecute(
      first,
      addKeyframeCommand({
        id: IDS.cmd7,
        baseVersion: 6,
        createdAt: T.t7,
        keyframeId: KEYFRAME_B,
        timeUs: "500000",
        value: 1.2,
      }),
    ).state;
    const beforeProject = canonicalStringify(second.project);
    const updated = mustExecute(second, updateKeyframeCommand()).state;

    expect(animationsOf(updated)?.[0]?.keyframes[1]).toMatchObject({
      id: KEYFRAME_A,
      timeUs: "750000",
      value: 1.5,
      easing: "ease-in-out",
    });

    const undone = undo(updated);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(canonicalStringify(undone.state.project)).toBe(beforeProject);

    const redone = redo(undone.state);
    expect(redone.ok).toBe(true);
    if (redone.ok) {
      expect(canonicalStringify(redone.state.project)).toBe(
        canonicalStringify(updated.project),
      );
    }
  });

  it("removes the final keyframe and restores absent animation state on undo", () => {
    const initial = clipState();
    expect(animationsOf(initial)).toBeUndefined();
    const added = mustExecute(initial, addKeyframeCommand()).state;
    const removed = mustExecute(added, removeKeyframeCommand(6)).state;
    expect(animationsOf(removed)).toBeUndefined();

    const undoRemove = undo(removed);
    expect(undoRemove.ok).toBe(true);
    if (!undoRemove.ok) return;
    expect(animationsOf(undoRemove.state)?.[0]?.keyframes).toHaveLength(1);

    const undoAdd = undo(undoRemove.state);
    expect(undoAdd.ok).toBe(true);
    if (undoAdd.ok) expect(animationsOf(undoAdd.state)).toBeUndefined();
  });

  it("replays animation operations to byte-equivalent canonical JSON", () => {
    let state = clipState();
    state = mustExecute(state, addKeyframeCommand()).state;
    state = mustExecute(state, updateKeyframeCommand({ baseVersion: 6 })).state;
    const operations = JSON.parse(
      JSON.stringify(state.operationLog),
    ) as ProjectOperation[];

    const result = replay(operations);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(canonicalStringify(result.state)).toBe(canonicalStringify(state));
    }
  });

  it("atomically replaces all animations and restores them with one undo", () => {
    const initial = mustExecute(clipState(), addKeyframeCommand()).state;
    const beforeProject = canonicalStringify(initial.project);
    const command = {
      id: IDS.cmd7,
      commandType: "timeline.update_clip_animations",
      baseVersion: 6,
      actor: USER,
      createdAt: T.t7,
      payload: {
        sequenceId: "sequence-1",
        clipId: "clip-1",
        animations: [
          {
            id: "auto-opacity",
            property: "transform.opacity",
            keyframes: [
              { id: "fade-a", timeUs: "0", value: 0, easing: "linear" },
              {
                id: "fade-b",
                timeUs: "1000000",
                value: 1,
                easing: "linear",
              },
            ],
          },
        ],
      },
    } as unknown as ProjectCommand;

    const replaced = mustExecute(initial, command).state;
    expect(animationsOf(replaced)?.map((track) => track.property)).toEqual([
      "transform.opacity",
    ]);
    const undone = undo(replaced);
    expect(undone.ok).toBe(true);
    if (undone.ok) {
      expect(canonicalStringify(undone.state.project)).toBe(beforeProject);
    }
  });
});

describe("animation command rejection", () => {
  it("rejects out-of-clip time without changing any state", () => {
    expectError(
      clipState(),
      addKeyframeCommand({ timeUs: "1000001" }),
      "OUT_OF_BOUNDS",
    );
  });

  it("rejects invalid values at the public validation boundary", () => {
    expectError(
      clipState(),
      addKeyframeCommand({ value: Number.NaN }),
      "VALIDATION_ERROR",
    );
  });

  it("rejects duplicate keyframe ids and times", () => {
    const first = mustExecute(clipState(), addKeyframeCommand()).state;
    expectError(
      first,
      addKeyframeCommand({ baseVersion: 6, timeUs: "500000" }),
      "DUPLICATE_ID",
    );
    expectError(
      first,
      addKeyframeCommand({
        baseVersion: 6,
        keyframeId: KEYFRAME_B,
        timeUs: "0",
      }),
      "VALIDATION_ERROR",
    );
  });

  it("rejects missing animation tracks and keyframes", () => {
    const state = mustExecute(clipState(), addKeyframeCommand()).state;
    expectError(
      state,
      updateKeyframeCommand({ baseVersion: 6, animationId: "missing" }),
      "ANIMATION_TRACK_NOT_FOUND",
    );
    expectError(
      state,
      updateKeyframeCommand({ baseVersion: 6, keyframeId: "missing" }),
      "KEYFRAME_NOT_FOUND",
    );
  });

  it("rejects a trim that would strand keyframes beyond the clip end", () => {
    const state = mustExecute(
      clipState(),
      addKeyframeCommand({ timeUs: "900000" }),
    ).state;
    const trim = {
      id: IDS.cmd7,
      commandType: "timeline.trim_clip",
      baseVersion: 6,
      actor: USER,
      createdAt: T.t7,
      payload: {
        sequenceId: "sequence-1",
        clipId: "clip-1",
        sourceInUs: "0",
        sourceOutUs: "500000",
      },
    } as const;

    expectError(state, trim, "OUT_OF_BOUNDS");
  });

  it("rejects an atomic preset containing a keyframe beyond the clip", () => {
    const command = {
      id: IDS.cmd6,
      commandType: "timeline.update_clip_animations",
      baseVersion: 5,
      actor: USER,
      createdAt: T.t6,
      payload: {
        sequenceId: "sequence-1",
        clipId: "clip-1",
        animations: [
          {
            id: "bad-track",
            property: "transform.scale",
            keyframes: [
              {
                id: "bad-keyframe",
                timeUs: "1000001",
                value: 1,
                easing: "linear",
              },
            ],
          },
        ],
      },
    } as unknown as ProjectCommand;

    expectError(clipState(), command, "OUT_OF_BOUNDS");
  });

  it("does not mutate caller-owned command objects", () => {
    const command = addKeyframeCommand({ timeUs: "500000" });
    const before = canonicalStringify(command);

    mustExecute(clipState(), command);

    expect(canonicalStringify(command)).toBe(before);
  });
});

describe("hand-drawn easing curves through update_keyframe", () => {
  const CURVE = { x1: 0.2, y1: 1.6, x2: 0.8, y2: 1 };

  /** A keyframe already carrying a curve, ready to be updated. */
  function curvedState(): EditorState {
    return mustExecute(clipState(), addKeyframeCommand({ bezier: CURVE }))
      .state;
  }

  it("stores a curve given to update_keyframe", () => {
    // The payload schema spreads the whole keyframe shape, so a curve is
    // *accepted* here whether or not the reducer does anything with it. A
    // reducer that drops it therefore fails silently: the command succeeds,
    // the version advances, and the animation plays the named easing.
    const state = mustExecute(clipState(), addKeyframeCommand()).state;
    const updated = mustExecute(
      state,
      updateKeyframeCommand({ baseVersion: 6, bezier: CURVE }),
    ).state;

    expect(animationsOf(updated)?.[0]?.keyframes[0]?.bezier).toEqual(CURVE);
  });

  it("replaces a curve already on the keyframe", () => {
    const other = { x1: 0.1, y1: 0, x2: 0.9, y2: 1 };
    const updated = mustExecute(
      curvedState(),
      updateKeyframeCommand({ baseVersion: 6, bezier: other }),
    ).state;

    expect(animationsOf(updated)?.[0]?.keyframes[0]?.bezier).toEqual(other);
  });

  it("discards the curve when the update carries none", () => {
    // The only way back to a named easing. Spreading the previous keyframe
    // would preserve the curve forever, and because a curve supersedes
    // `easing`, the easing dropdown would then appear to do nothing at all.
    const updated = mustExecute(
      curvedState(),
      updateKeyframeCommand({ baseVersion: 6, easing: "ease-in" }),
    ).state;

    const keyframe = animationsOf(updated)?.[0]?.keyframes[0];
    expect(keyframe?.easing).toBe("ease-in");
    expect(keyframe).not.toHaveProperty("bezier");
  });

  it("leaves no bezier key behind, rather than an undefined one", () => {
    // Canonical JSON distinguishes absent from present-and-undefined, so a
    // discarded curve that leaves `bezier: undefined` changes the project's
    // bytes and breaks byte-exact replay.
    const updated = mustExecute(
      curvedState(),
      updateKeyframeCommand({ baseVersion: 6, easing: "linear" }),
    ).state;

    expect(canonicalStringify(animationsOf(updated))).not.toContain("bezier");
  });

  it("restores the curve on undo", () => {
    const before = curvedState();
    const after = mustExecute(
      before,
      updateKeyframeCommand({ baseVersion: 6, easing: "linear" }),
    ).state;
    const back = undo(after);

    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(animationsOf(back.state)?.[0]?.keyframes[0]?.bezier).toEqual(CURVE);
  });

  it("replays byte-for-byte with a curve in the log", () => {
    const state = mustExecute(
      curvedState(),
      updateKeyframeCommand({ baseVersion: 6, bezier: CURVE }),
    ).state;
    const replayed = replay(state.operationLog);

    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(canonicalStringify(replayed.state.project)).toBe(
      canonicalStringify(state.project),
    );
  });
});
