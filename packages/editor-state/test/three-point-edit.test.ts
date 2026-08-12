import { describe, expect, it } from "vitest";
import { canonicalStringify } from "@director/canonical-json";
import type { ProjectCommand } from "@director/command-schema";
import type { TimelineClip } from "@director/project-schema";
import {
  executeCommand,
  replay,
  undo,
  type EditorState,
} from "../src/index.js";
import {
  addClipCommand,
  baseTimelineState,
  IDS,
  mustExecute,
  T,
} from "./fixtures.js";

/**
 * `timeline.insert_clip` and `timeline.overwrite_clip` — the destination half of
 * three-point editing.
 *
 * `add_clip` places a clip where nothing is and refuses with OVERLAP where
 * something is. These two say what to do about the something: insert pushes it
 * later, overwrite replaces it. The browser range supplies source in and out;
 * the playhead supplies the destination; the fourth point is derived.
 *
 * Both rearrange an unbounded number of clips in one gesture, so both are one
 * command and one undo. The fixture's asset is five seconds long.
 */

const USER = { type: "user", id: "user-1" } as const;

/** Clips on track-1, as [id, start, duration, sourceIn] — the whole shape each
 * assertion cares about, in one readable row. */
function layout(state: EditorState): Array<[string, string, string, string]> {
  const track = state.project?.sequences[0]?.tracks[0];
  return (track?.clips ?? []).map((c: TimelineClip) => [
    c.id,
    c.timelineStartUs,
    c.timelineDurationUs,
    c.sourceInUs,
  ]);
}

/**
 * Two one-second clips laid end to end: A at 0, B at 1s. Version 6.
 *
 * Adjacent rather than spaced, because adjacency is what makes a ripple
 * visible — a gap would absorb the shift and hide the bug.
 */
function twoClips(): EditorState {
  let state = baseTimelineState();
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
      sourceInUs: "1000000",
      sourceOutUs: "2000000",
    }),
  ).state;
  return state;
}

const edit = (
  state: EditorState,
  commandType: "timeline.insert_clip" | "timeline.overwrite_clip",
  opts: {
    at: string;
    sourceInUs?: string;
    sourceOutUs?: string;
    clipId?: string;
    splitClipId?: string;
    trackId?: string;
  },
): ReturnType<typeof executeCommand> =>
  executeCommand(state, {
    id: IDS.cmd7,
    commandType,
    baseVersion: state.project?.currentVersion ?? 0,
    actor: USER,
    createdAt: T.t7,
    payload: {
      sequenceId: "sequence-1",
      trackId: opts.trackId ?? "track-1",
      clip: {
        id: opts.clipId ?? "clip-new",
        assetId: "asset-1",
        timelineStartUs: opts.at,
        sourceInUs: opts.sourceInUs ?? "3000000",
        sourceOutUs: opts.sourceOutUs ?? "3500000",
        playbackRate: { numerator: 1, denominator: 1 },
      },
      ...(opts.splitClipId === undefined
        ? {}
        : { splitClipId: opts.splitClipId }),
    },
  } as ProjectCommand);

describe("timeline.insert_clip", () => {
  it("pushes everything at or after the point later by the clip's duration", () => {
    const result = edit(twoClips(), "timeline.insert_clip", { at: "1000000" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A is untouched; the new half-second clip takes 1s–1.5s; B moves to 1.5s.
    expect(layout(result.state)).toEqual([
      ["clip-a", "0", "1000000", "0"],
      ["clip-new", "1000000", "500000", "3000000"],
      ["clip-b", "1500000", "1000000", "1000000"],
    ]);
  });

  it("inserts at the very start and moves both clips", () => {
    const result = edit(twoClips(), "timeline.insert_clip", { at: "0" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(layout(result.state)).toEqual([
      ["clip-new", "0", "500000", "3000000"],
      ["clip-a", "500000", "1000000", "0"],
      ["clip-b", "1500000", "1000000", "1000000"],
    ]);
  });

  it("splits the clip it lands inside", () => {
    // Landing at 0.5s cuts A in two. The left half keeps A's id and source
    // in-point; the right half is a new clip whose source starts where the cut
    // fell, so the picture is continuous across the insert.
    const result = edit(twoClips(), "timeline.insert_clip", {
      at: "500000",
      splitClipId: "clip-a2",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(layout(result.state)).toEqual([
      ["clip-a", "0", "500000", "0"],
      ["clip-new", "500000", "500000", "3000000"],
      ["clip-a2", "1000000", "500000", "500000"],
      ["clip-b", "1500000", "1000000", "1000000"],
    ]);
  });

  it("refuses a mid-clip insert with no id for the second half", () => {
    // Refused rather than guessed: reducers never invent identity, and a
    // generated id would not replay to the bytes the command recorded.
    const result = edit(twoClips(), "timeline.insert_clip", { at: "500000" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("refuses a split id already in use", () => {
    const result = edit(twoClips(), "timeline.insert_clip", {
      at: "500000",
      splitClipId: "clip-b",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DUPLICATE_ID");
  });

  it("places a clip past the end with nothing to ripple", () => {
    const result = edit(twoClips(), "timeline.insert_clip", { at: "4000000" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(layout(result.state)[2]).toEqual([
      "clip-new",
      "4000000",
      "500000",
      "3000000",
    ]);
  });

  it("leaves other tracks where they are", () => {
    // Rippling every track is the magnetic timeline, which is a separate
    // decision about what a track even is. A lane here is independent.
    let state = mustExecute(twoClips(), {
      id: IDS.cmd8,
      commandType: "timeline.add_track",
      baseVersion: 6,
      actor: USER,
      createdAt: T.t8,
      payload: {
        sequenceId: "sequence-1",
        track: { id: "track-2", kind: "video", name: "V2", index: 1 },
      },
    } as ProjectCommand).state;
    state = mustExecute(
      state,
      addClipCommand({
        id: "00000000-0000-4000-8000-00000000000a",
        createdAt: T.t8,
        baseVersion: 7,
        clipId: "clip-c",
        trackId: "track-2",
        timelineStartUs: "0",
        sourceInUs: "0",
        sourceOutUs: "1000000",
      }),
    ).state;

    const result = edit(state, "timeline.insert_clip", { at: "0" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const other = result.state.project?.sequences[0]?.tracks[1];
    expect(other?.clips[0]?.timelineStartUs).toBe("0");
  });
});

describe("timeline.overwrite_clip", () => {
  it("replaces what it lands on, removing a clip it fully covers", () => {
    const result = edit(twoClips(), "timeline.overwrite_clip", {
      at: "1000000",
      sourceInUs: "3000000",
      sourceOutUs: "4000000",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // B occupied exactly 1s–2s and the overwrite covers exactly that.
    expect(layout(result.state)).toEqual([
      ["clip-a", "0", "1000000", "0"],
      ["clip-new", "1000000", "1000000", "3000000"],
    ]);
  });

  it("trims a clip that crosses the start edge", () => {
    const result = edit(twoClips(), "timeline.overwrite_clip", {
      at: "500000",
      sourceInUs: "3000000",
      sourceOutUs: "4500000",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A is cut back to end at 0.5s; B was fully covered and is gone.
    expect(layout(result.state)).toEqual([
      ["clip-a", "0", "500000", "0"],
      ["clip-new", "500000", "1500000", "3000000"],
    ]);
  });

  it("trims a clip that crosses the end edge, advancing its source", () => {
    const result = edit(twoClips(), "timeline.overwrite_clip", {
      at: "0",
      sourceInUs: "3000000",
      sourceOutUs: "4500000",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The span covers 0–1.5s: A goes entirely, B keeps its last half second and
    // its source in-point moves with the cut — otherwise it would repeat the
    // frames the overwrite just covered.
    expect(layout(result.state)).toEqual([
      ["clip-new", "0", "1500000", "3000000"],
      ["clip-b", "1500000", "500000", "1500000"],
    ]);
  });

  it("cuts a clip in two when the span falls inside it", () => {
    const result = edit(twoClips(), "timeline.overwrite_clip", {
      at: "250000",
      sourceInUs: "3000000",
      sourceOutUs: "3500000",
      splitClipId: "clip-a2",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(layout(result.state)).toEqual([
      ["clip-a", "0", "250000", "0"],
      ["clip-new", "250000", "500000", "3000000"],
      ["clip-a2", "750000", "250000", "750000"],
      ["clip-b", "1000000", "1000000", "1000000"],
    ]);
  });

  it("refuses to cut a clip in two with no id for the second half", () => {
    const result = edit(twoClips(), "timeline.overwrite_clip", {
      at: "250000",
      sourceInUs: "3000000",
      sourceOutUs: "3500000",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("places a clip over empty track exactly as add would", () => {
    const result = edit(twoClips(), "timeline.overwrite_clip", {
      at: "3000000",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(layout(result.state)).toHaveLength(3);
    expect(layout(result.state)[2]?.[1]).toBe("3000000");
  });
});

describe("what a cut clip keeps", () => {
  /** clip-a, carrying a transition at each end and two markers. */
  function decoratedClips(): EditorState {
    let state = twoClips();
    let version = 6;
    const send = (commandType: string, payload: unknown, id: string): void => {
      state = mustExecute(state, {
        id,
        commandType,
        baseVersion: version,
        actor: USER,
        createdAt: T.t7,
        payload,
      } as ProjectCommand).state;
      version += 1;
    };
    send(
      "timeline.set_clip_transition",
      {
        sequenceId: "sequence-1",
        clipId: "clip-a",
        side: "in",
        transition: {
          id: "t-in",
          kind: "cross",
          durationUs: "200000",
          easing: "linear",
        },
      },
      "00000000-0000-4000-8000-00000000000b",
    );
    send(
      "timeline.set_clip_transition",
      {
        sequenceId: "sequence-1",
        clipId: "clip-a",
        side: "out",
        transition: {
          id: "t-out",
          kind: "cross",
          durationUs: "200000",
          easing: "linear",
        },
      },
      "00000000-0000-4000-8000-00000000000c",
    );
    send(
      "timeline.add_marker",
      {
        sequenceId: "sequence-1",
        clipId: "clip-a",
        marker: {
          id: "m-early",
          timeUs: "100000",
          name: "early",
          kind: "standard",
        },
      },
      "00000000-0000-4000-8000-00000000000d",
    );
    send(
      "timeline.add_marker",
      {
        sequenceId: "sequence-1",
        clipId: "clip-a",
        marker: {
          id: "m-late",
          timeUs: "800000",
          name: "late",
          kind: "standard",
        },
      },
      "00000000-0000-4000-8000-00000000000e",
    );
    return state;
  }

  const halves = (state: EditorState) => {
    const clips = state.project?.sequences[0]?.tracks[0]?.clips ?? [];
    return {
      left: clips.find((c) => c.id === "clip-a"),
      right: clips.find((c) => c.id === "clip-a2"),
    };
  };

  it("gives each transition to the end it belongs to", () => {
    // Copying both onto both halves would ramp against inner edges that do not
    // exist, and could exceed the shorter half's duration.
    const result = edit(decoratedClips(), "timeline.insert_clip", {
      at: "500000",
      splitClipId: "clip-a2",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { left, right } = halves(result.state);
    expect(left?.transitionIn?.durationUs).toBe("200000");
    expect(left).not.toHaveProperty("transitionOut");
    expect(right).not.toHaveProperty("transitionIn");
    expect(right?.transitionOut?.durationUs).toBe("200000");
  });

  it("sends each marker to the half it falls in, rebased", () => {
    // Marker times are clip-local, so the late one has to be re-measured from
    // the new clip's start: 800ms into the original is 300ms into the second
    // half of a cut at 500ms.
    const result = edit(decoratedClips(), "timeline.insert_clip", {
      at: "500000",
      splitClipId: "clip-a2",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { left, right } = halves(result.state);
    expect(left?.markers).toEqual([
      { id: "m-early", timeUs: "100000", name: "early", kind: "standard" },
    ]);
    expect(right?.markers).toEqual([
      { id: "m-late", timeUs: "300000", name: "late", kind: "standard" },
    ]);
  });

  it("refuses to cut an animated clip rather than guess", () => {
    // trim_clip already refuses to strand a keyframe past a shortened clip;
    // reaching that state by another route would be inconsistent.
    const animated = mustExecute(twoClips(), {
      id: "00000000-0000-4000-8000-00000000000f",
      commandType: "timeline.update_clip_animations",
      baseVersion: 6,
      actor: USER,
      createdAt: T.t7,
      payload: {
        sequenceId: "sequence-1",
        clipId: "clip-a",
        animations: [
          {
            id: "anim-1",
            property: "transform.opacity",
            keyframes: [
              { id: "k1", timeUs: "0", value: 0, easing: "linear" },
              { id: "k2", timeUs: "900000", value: 1, easing: "linear" },
            ],
          },
        ],
      },
    } as ProjectCommand).state;

    const result = edit(animated, "timeline.insert_clip", {
      at: "500000",
      splitClipId: "clip-a2",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OUT_OF_BOUNDS");
  });

  it("still inserts at an animated clip's edge, which cuts nothing", () => {
    const animated = mustExecute(twoClips(), {
      id: "00000000-0000-4000-8000-000000000010",
      commandType: "timeline.update_clip_animations",
      baseVersion: 6,
      actor: USER,
      createdAt: T.t7,
      payload: {
        sequenceId: "sequence-1",
        clipId: "clip-a",
        animations: [
          {
            id: "anim-1",
            property: "transform.opacity",
            keyframes: [
              { id: "k1", timeUs: "0", value: 0, easing: "linear" },
              { id: "k2", timeUs: "900000", value: 1, easing: "linear" },
            ],
          },
        ],
      },
    } as ProjectCommand).state;

    const result = edit(animated, "timeline.insert_clip", { at: "1000000" });
    expect(result.ok).toBe(true);
  });
});

describe("both commands, shared rules", () => {
  for (const commandType of [
    "timeline.insert_clip",
    "timeline.overwrite_clip",
  ] as const) {
    describe(commandType, () => {
      it("refuses an unknown track", () => {
        const result = edit(twoClips(), commandType, {
          at: "0",
          trackId: "ghost",
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("TRACK_NOT_FOUND");
      });

      it("refuses a clip id already on the timeline", () => {
        const result = edit(twoClips(), commandType, {
          at: "3000000",
          clipId: "clip-a",
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("DUPLICATE_ID");
      });

      it("refuses a source range past the asset", () => {
        const result = edit(twoClips(), commandType, {
          at: "3000000",
          sourceInUs: "4000000",
          sourceOutUs: "9000000",
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("INVALID_TIME_RANGE");
      });

      it("undoes the whole rearrangement in one step", () => {
        const before = twoClips();
        const result = edit(before, commandType, {
          at: "500000",
          splitClipId: "clip-a2",
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const undone = undo(result.state);
        expect(undone.ok).toBe(true);
        if (!undone.ok) return;
        // One undo, byte-exact — a ripple or an overwrite is one gesture, and
        // composing it from move/trim/delete would have made it several.
        expect(canonicalStringify(undone.state.project)).toBe(
          canonicalStringify(before.project),
        );
      });

      it("replays byte-for-byte", () => {
        const result = edit(twoClips(), commandType, {
          at: "500000",
          splitClipId: "clip-a2",
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const replayed = replay(result.state.operationLog);
        expect(replayed.ok).toBe(true);
        if (!replayed.ok) return;
        expect(canonicalStringify(replayed.state.project)).toBe(
          canonicalStringify(result.state.project),
        );
      });
    });
  }
});
