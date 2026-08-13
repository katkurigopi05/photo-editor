import { describe, expect, it } from "vitest";
import { canonicalStringify } from "@director/canonical-json";
import type { ProjectCommand } from "@director/command-schema";
import { executeCommand, undo, type EditorState } from "../src/index.js";
import {
  addClipCommand,
  baseTimelineState,
  IDS,
  mustExecute,
  T,
} from "./fixtures.js";

/**
 * A magnetic track keeps its clips packed end to end.
 *
 * The packing itself is unit-tested in project-schema. What matters here is
 * that the invariant survives *real commands* — because it is applied at the
 * one place a track is written back, not by each command remembering to.
 */

const USER = { type: "user", id: "user-1" } as const;

const layout = (state: EditorState) =>
  (state.project?.sequences[0]?.tracks[0]?.clips ?? []).map(
    (c) => [c.id, c.timelineStartUs] as const,
  );

const setMagnetic = (
  state: EditorState,
  magnetic: boolean,
  id: string,
  createdAt: string,
): ReturnType<typeof executeCommand> =>
  executeCommand(state, {
    id,
    commandType: "timeline.set_track_magnetic",
    baseVersion: state.project?.currentVersion ?? 0,
    actor: USER,
    createdAt,
    payload: { sequenceId: "sequence-1", trackId: "track-1", magnetic },
  } as ProjectCommand);

/** Two clips with a gap between them. */
function gapped(): EditorState {
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
      timelineStartUs: "4000000",
      sourceInUs: "0",
      sourceOutUs: "1000000",
    }),
  ).state;
  return state;
}

describe("timeline.set_track_magnetic", () => {
  it("packs the track the moment it is turned on", () => {
    // Visible immediately rather than at the next edit — otherwise the flag
    // would look like it had done nothing.
    const result = setMagnetic(gapped(), true, IDS.cmd7, T.t7);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(layout(result.state)).toEqual([
      ["clip-a", "0"],
      ["clip-b", "1000000"],
    ]);
  });

  it("leaves an ordinary track's gaps alone", () => {
    expect(layout(gapped())).toEqual([
      ["clip-a", "0"],
      ["clip-b", "4000000"],
    ]);
  });

  it("refuses an unknown track", () => {
    const result = executeCommand(gapped(), {
      id: IDS.cmd7,
      commandType: "timeline.set_track_magnetic",
      baseVersion: 6,
      actor: USER,
      createdAt: T.t7,
      payload: { sequenceId: "sequence-1", trackId: "ghost", magnetic: true },
    } as ProjectCommand);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TRACK_NOT_FOUND");
  });

  it("undoes the flag and the positions it packed", () => {
    // Turning it off does not un-pack, so undo has to carry where the clips
    // were: the gaps cannot be derived from a packed track.
    const before = gapped();
    const result = setMagnetic(before, true, IDS.cmd7, T.t7);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const undone = undo(result.state);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(canonicalStringify(undone.state.project)).toBe(
      canonicalStringify(before.project),
    );
  });

  it("stores the flag as absent rather than false when turned off", () => {
    const on = setMagnetic(gapped(), true, IDS.cmd7, T.t7);
    expect(on.ok).toBe(true);
    if (!on.ok) return;
    const off = setMagnetic(on.state, false, IDS.cmd8, T.t8);
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    // An untouched track carries no member, and canonical JSON treats the two
    // as different projects.
    expect(off.state.project?.sequences[0]?.tracks[0]).not.toHaveProperty(
      "magnetic",
    );
  });
});

describe("the invariant survives ordinary commands", () => {
  function magneticPair(): EditorState {
    const on = setMagnetic(gapped(), true, IDS.cmd7, T.t7);
    if (!on.ok) throw new Error("fixture failed");
    return on.state;
  }

  it("closes the gap when a clip is deleted", () => {
    // Nothing in delete_clip knows about magnetism; it inherits the invariant
    // from the one place a track is written back.
    const state = magneticPair();
    const result = executeCommand(state, {
      id: IDS.cmd8,
      commandType: "timeline.delete_clip",
      baseVersion: state.project?.currentVersion ?? 0,
      actor: USER,
      createdAt: T.t8,
      payload: { sequenceId: "sequence-1", clipId: "clip-a" },
    } as ProjectCommand);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(layout(result.state)).toEqual([["clip-b", "0"]]);
  });

  it("repacks after a clip is moved past its neighbour", () => {
    const state = magneticPair();
    const result = executeCommand(state, {
      id: IDS.cmd8,
      commandType: "timeline.move_clip",
      baseVersion: state.project?.currentVersion ?? 0,
      actor: USER,
      createdAt: T.t8,
      payload: {
        sequenceId: "sequence-1",
        clipId: "clip-a",
        targetTrackId: "track-1",
        timelineStartUs: "9000000",
      },
    } as ProjectCommand);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Dragged past clip-b, so the order swaps and the pair repacks from zero.
    expect(layout(result.state)).toEqual([
      ["clip-b", "0"],
      ["clip-a", "1000000"],
    ]);
  });

  it("never leaves a gap, whatever the edit", () => {
    const state = magneticPair();
    const trimmed = executeCommand(state, {
      id: IDS.cmd8,
      commandType: "timeline.trim_clip",
      baseVersion: state.project?.currentVersion ?? 0,
      actor: USER,
      createdAt: T.t8,
      payload: {
        sequenceId: "sequence-1",
        clipId: "clip-a",
        sourceInUs: "0",
        sourceOutUs: "400000",
      },
    } as ProjectCommand);
    expect(trimmed.ok).toBe(true);
    if (!trimmed.ok) return;
    const clips = trimmed.state.project?.sequences[0]?.tracks[0]?.clips ?? [];
    let expected = 0n;
    for (const clip of clips) {
      expect(clip.timelineStartUs).toBe(expected.toString());
      expected += BigInt(clip.timelineDurationUs);
    }
  });
});
