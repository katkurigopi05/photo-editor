import { describe, expect, it } from "vitest";
import { canonicalStringify } from "@director/canonical-json";
import type { ProjectCommand } from "@director/command-schema";
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

/** The fixture clip runs 0 -> 1_000_000us on track-1. */
function clipState(): EditorState {
  return mustExecute(
    baseTimelineState(),
    addClipCommand({ id: IDS.cmd5, createdAt: T.t5, baseVersion: 4 }),
  ).state;
}

function clipOf(state: EditorState) {
  return state.project?.sequences[0]?.tracks[0]?.clips[0];
}

function setTransitionCommand(
  overrides: Partial<{
    id: string;
    baseVersion: number;
    createdAt: string;
    clipId: string;
    side: "in" | "out";
    transition: unknown;
  }> = {},
): ProjectCommand {
  return {
    id: overrides.id ?? IDS.cmd6,
    commandType: "timeline.set_clip_transition",
    createdAt: overrides.createdAt ?? T.t6,
    actor: USER,
    baseVersion: overrides.baseVersion ?? 5,
    payload: {
      sequenceId: "sequence-1",
      clipId: overrides.clipId ?? "clip-1",
      side: overrides.side ?? "in",
      transition:
        overrides.transition === undefined
          ? {
              id: "transition-1",
              kind: "cross",
              durationUs: "250000",
              easing: "ease-in-out",
            }
          : overrides.transition,
    },
  } as ProjectCommand;
}

function expectError(
  command: ProjectCommand,
  code: CommandErrorCode,
  state: EditorState,
): void {
  const result = executeCommand(state, command);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

describe("timeline.set_clip_transition", () => {
  it("attaches an incoming transition to a clip", () => {
    const { state } = mustExecute(clipState(), setTransitionCommand());
    expect(clipOf(state)?.transitionIn).toEqual({
      id: "transition-1",
      kind: "cross",
      durationUs: "250000",
      easing: "ease-in-out",
    });
    expect(clipOf(state)?.transitionOut).toBeUndefined();
  });

  it("attaches an outgoing transition independently", () => {
    const { state } = mustExecute(
      clipState(),
      setTransitionCommand({ side: "out" }),
    );
    expect(clipOf(state)?.transitionOut?.id).toBe("transition-1");
    expect(clipOf(state)?.transitionIn).toBeUndefined();
  });

  it("stores a dip with its colour", () => {
    const { state } = mustExecute(
      clipState(),
      setTransitionCommand({
        transition: {
          id: "dip-1",
          kind: "dip",
          durationUs: "100000",
          easing: "linear",
          colorHex: "#ffffff",
        },
      }),
    );
    expect(clipOf(state)?.transitionIn?.colorHex).toBe("#ffffff");
  });

  it("removes the transition when the payload is null", () => {
    const withTransition = mustExecute(
      clipState(),
      setTransitionCommand(),
    ).state;
    const { state } = mustExecute(
      withTransition,
      setTransitionCommand({
        id: IDS.cmd7,
        baseVersion: 6,
        createdAt: T.t7,
        transition: null,
      }),
    );
    // Absent, not present-and-null: schema-v1 clips must stay byte-identical.
    expect(clipOf(state)).not.toHaveProperty("transitionIn");
  });

  it("rejects a transition longer than the clip", () => {
    // Fixture clip is 1s; a 2s ramp has no window to run in.
    expectError(
      setTransitionCommand({
        transition: {
          id: "too-long",
          kind: "cross",
          durationUs: "2000000",
          easing: "linear",
        },
      }),
      "TRANSITION_TOO_LONG",
      clipState(),
    );
  });

  it("rejects an out transition that no longer fits beside the in one", () => {
    const withIn = mustExecute(
      clipState(),
      setTransitionCommand({
        transition: {
          id: "in-1",
          kind: "cross",
          durationUs: "600000",
          easing: "linear",
        },
      }),
    ).state;
    expectError(
      setTransitionCommand({
        id: IDS.cmd7,
        baseVersion: 6,
        createdAt: T.t7,
        side: "out",
        transition: {
          id: "out-1",
          kind: "cross",
          durationUs: "600000",
          easing: "linear",
        },
      }),
      "TRANSITION_TOO_LONG",
      withIn,
    );
  });

  it("accepts in + out that exactly fill the clip", () => {
    const withIn = mustExecute(
      clipState(),
      setTransitionCommand({
        transition: {
          id: "in-1",
          kind: "cross",
          durationUs: "500000",
          easing: "linear",
        },
      }),
    ).state;
    const { state } = mustExecute(
      withIn,
      setTransitionCommand({
        id: IDS.cmd7,
        baseVersion: 6,
        createdAt: T.t7,
        side: "out",
        transition: {
          id: "out-1",
          kind: "cross",
          durationUs: "500000",
          easing: "linear",
        },
      }),
    );
    expect(clipOf(state)?.transitionIn?.durationUs).toBe("500000");
    expect(clipOf(state)?.transitionOut?.durationUs).toBe("500000");
  });

  it("rejects a zero-length transition at the schema boundary", () => {
    expectError(
      setTransitionCommand({
        transition: {
          id: "zero",
          kind: "cross",
          durationUs: "0",
          easing: "linear",
        },
      }),
      "VALIDATION_ERROR",
      clipState(),
    );
  });

  it("rejects a colour on a crossfade", () => {
    expectError(
      setTransitionCommand({
        transition: {
          id: "bad",
          kind: "cross",
          durationUs: "100000",
          easing: "linear",
          colorHex: "#000000",
        },
      }),
      "VALIDATION_ERROR",
      clipState(),
    );
  });

  it("rejects an unknown clip", () => {
    expectError(
      setTransitionCommand({ clipId: "missing" }),
      "CLIP_NOT_FOUND",
      clipState(),
    );
  });
});

describe("bounded overlap for a same-track crossfade", () => {
  const CROSS_200 = {
    id: "x1",
    kind: "cross" as const,
    durationUs: "200000",
    easing: "linear" as const,
  };

  /** clip-1 [0,1s) plus clip-2 [1s,2s) adjacent on the same track. */
  function twoClips(): EditorState {
    const first = clipState();
    return mustExecute(
      first,
      addClipCommand({
        id: IDS.cmd6,
        createdAt: T.t6,
        baseVersion: 5,
        clipId: "clip-2",
        timelineStartUs: "1000000",
        sourceInUs: "0",
        sourceOutUs: "1000000",
      }),
    ).state;
  }

  /** Give clip-2 an incoming crossfade, then try to slide it back by `byUs`. */
  function slideBack(
    byUs: string,
    transition: unknown = CROSS_200,
  ): { state: EditorState; command: ProjectCommand } {
    const withTransition = mustExecute(
      twoClips(),
      setTransitionCommand({
        id: IDS.cmd7,
        baseVersion: 6,
        createdAt: T.t7,
        clipId: "clip-2",
        side: "in",
        transition,
      }),
    ).state;
    return {
      state: withTransition,
      command: {
        id: IDS.cmd8,
        commandType: "timeline.move_clip",
        createdAt: T.t8,
        actor: USER,
        baseVersion: 7,
        payload: {
          sequenceId: "sequence-1",
          clipId: "clip-2",
          targetTrackId: "track-1",
          timelineStartUs: (1_000_000 - Number(byUs)).toString(),
        },
      } as ProjectCommand,
    };
  }

  it("allows an overlap exactly covered by the incoming crossfade", () => {
    const { state, command } = slideBack("200000");
    const { state: moved } = mustExecute(state, command);
    const clips = moved.project?.sequences[0]?.tracks[0]?.clips ?? [];
    expect(clips.map((c) => c.timelineStartUs)).toContain("800000");
  });

  it("allows an overlap smaller than the crossfade", () => {
    // A ramp longer than the overlap simply finishes against the background.
    const { state, command } = slideBack("100000");
    expect(executeCommand(state, command).ok).toBe(true);
  });

  it("rejects an overlap larger than the crossfade", () => {
    // 300ms of overlap under a 200ms ramp would leave 100ms where both clips
    // are fully opaque and the top one just hides the other.
    const { state, command } = slideBack("300000");
    expectError(command, "OVERLAP", state);
  });

  it("allows an overlap covered by a slide", () => {
    // A slide reveals the clip underneath by travelling off it, so it covers
    // an overlap just as a crossfade does.
    const { state, command } = slideBack("200000", {
      id: "s1",
      kind: "slide",
      durationUs: "200000",
      easing: "linear",
      direction: "left",
    });
    expect(executeCommand(state, command).ok).toBe(true);
  });

  it("rejects an overlap larger than a slide", () => {
    const { state, command } = slideBack("300000", {
      id: "s2",
      kind: "slide",
      durationUs: "200000",
      easing: "linear",
      direction: "right",
    });
    expectError(command, "OVERLAP", state);
  });

  it("rejects an overlap covered only by a dip", () => {
    // A dip ramps against a colour, not against the clip underneath.
    const { state, command } = slideBack("200000", {
      id: "d1",
      kind: "dip",
      durationUs: "200000",
      easing: "linear",
      colorHex: "#000000",
    });
    expectError(command, "OVERLAP", state);
  });

  it("rejects an overlap when the later clip has no transition at all", () => {
    const state = twoClips();
    expectError(
      {
        id: IDS.cmd8,
        commandType: "timeline.move_clip",
        createdAt: T.t8,
        actor: USER,
        baseVersion: 6,
        payload: {
          sequenceId: "sequence-1",
          clipId: "clip-2",
          targetTrackId: "track-1",
          timelineStartUs: "800000",
        },
      } as ProjectCommand,
      "OVERLAP",
      state,
    );
  });

  it("refuses to clear a crossfade that is holding an overlap legal", () => {
    const { state, command } = slideBack("200000");
    const overlapped = mustExecute(state, command).state;
    expectError(
      setTransitionCommand({
        // The shared fixture only numbers ids up to cmd8.
        id: "00000000-0000-4000-8000-000000000009",
        baseVersion: 8,
        createdAt: "2026-01-09T00:00:00.000Z",
        clipId: "clip-2",
        side: "in",
        transition: null,
      }),
      "OVERLAP",
      overlapped,
    );
  });

  it("still rejects a plain overlap with no transitions anywhere", () => {
    // The relaxation must not have widened the invariant generally.
    const state = twoClips();
    expectError(
      {
        id: IDS.cmd8,
        commandType: "timeline.move_clip",
        createdAt: T.t8,
        actor: USER,
        baseVersion: 6,
        payload: {
          sequenceId: "sequence-1",
          clipId: "clip-2",
          targetTrackId: "track-1",
          timelineStartUs: "0",
        },
      } as ProjectCommand,
      "OVERLAP",
      state,
    );
  });
});

describe("set_clip_transition undo/redo", () => {
  it("undo restores a clip that had no transition", () => {
    const { state } = mustExecute(clipState(), setTransitionCommand());
    const undone = undo(state);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(clipOf(undone.state)).not.toHaveProperty("transitionIn");
  });

  it("undo restores the transition that was replaced", () => {
    const first = mustExecute(clipState(), setTransitionCommand()).state;
    const second = mustExecute(
      first,
      setTransitionCommand({
        id: IDS.cmd7,
        baseVersion: 6,
        createdAt: T.t7,
        transition: {
          id: "transition-2",
          kind: "dip",
          durationUs: "400000",
          easing: "hold",
          colorHex: "#123456",
        },
      }),
    ).state;
    expect(clipOf(second)?.transitionIn?.id).toBe("transition-2");

    const undone = undo(second);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(clipOf(undone.state)?.transitionIn?.id).toBe("transition-1");
  });

  it("redo reapplies the transition", () => {
    const { state } = mustExecute(clipState(), setTransitionCommand());
    const undone = undo(state);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    const redone = redo(undone.state);
    expect(redone.ok).toBe(true);
    if (!redone.ok) return;
    expect(clipOf(redone.state)?.transitionIn?.id).toBe("transition-1");
  });

  it("replays to byte-identical state", () => {
    const { state } = mustExecute(clipState(), setTransitionCommand());
    const replayed = replay(state.operationLog);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(canonicalStringify(replayed.state.project)).toBe(
      canonicalStringify(state.project),
    );
  });
});
