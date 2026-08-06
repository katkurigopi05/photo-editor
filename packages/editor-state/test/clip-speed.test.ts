import { describe, expect, it } from "vitest";
import { canonicalStringify } from "@director/canonical-json";
import type { ProjectCommand } from "@director/command-schema";
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
 * `timeline.set_clip_speed`.
 *
 * Speed is the one clip property that changes how much timeline a clip
 * occupies, so the reducer has to recompute `timelineDurationUs` and re-check
 * everything that depends on it: overlaps with the clips that follow, and
 * keyframes that would be stranded past the new end. Getting that wrong
 * produces a project whose own schema rejects it — which is why the inverse is
 * checked byte-for-byte here too.
 */

const USER = { type: "user", id: "user-1" } as const;

function clipState(): EditorState {
  return mustExecute(
    baseTimelineState(),
    addClipCommand({ id: IDS.cmd5, createdAt: T.t5, baseVersion: 4 }),
  ).state;
}

const theClip = (state: EditorState) =>
  state.project?.sequences[0]?.tracks[0]?.clips[0];

const speedCmd = (
  numerator: number,
  denominator: number,
  overrides: Partial<{ id: string; baseVersion: number; clipId: string }> = {},
): ProjectCommand =>
  ({
    id: overrides.id ?? IDS.cmd6,
    commandType: "timeline.set_clip_speed",
    baseVersion: overrides.baseVersion ?? 5,
    actor: USER,
    createdAt: T.t6,
    payload: {
      sequenceId: "sequence-1",
      clipId: overrides.clipId ?? "clip-1",
      playbackRate: { numerator, denominator },
    },
  }) as ProjectCommand;

describe("set_clip_speed", () => {
  it("defaults a new clip to normal speed", () => {
    expect(theClip(clipState())?.playbackRate).toEqual({
      numerator: 1,
      denominator: 1,
    });
  });

  it("halves the timeline duration at double speed", () => {
    const before = theClip(clipState())!;
    const result = executeCommand(clipState(), speedCmd(2, 1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const clip = theClip(result.state)!;
    expect(clip.playbackRate).toEqual({ numerator: 2, denominator: 1 });
    expect(BigInt(clip.timelineDurationUs)).toBe(
      BigInt(before.timelineDurationUs) / 2n,
    );
    // The source range is untouched: speed changes how the same frames are
    // spread over the timeline, not which frames are used.
    expect(clip.sourceInUs).toBe(before.sourceInUs);
    expect(clip.sourceOutUs).toBe(before.sourceOutUs);
  });

  it("doubles the timeline duration at half speed", () => {
    const before = theClip(clipState())!;
    const result = executeCommand(clipState(), speedCmd(1, 2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(BigInt(theClip(result.state)!.timelineDurationUs)).toBe(
      BigInt(before.timelineDurationUs) * 2n,
    );
  });

  it("rejects a rate outside the supported range", () => {
    const result = executeCommand(clipState(), speedCmd(9, 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an unreduced rate", () => {
    const result = executeCommand(clipState(), speedCmd(2, 2));
    expect(result.ok).toBe(false);
  });

  it("reports a missing clip", () => {
    const result = executeCommand(
      clipState(),
      speedCmd(2, 1, { clipId: "nope" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CLIP_NOT_FOUND");
  });

  it("refuses a slowdown that would overlap the next clip", () => {
    // Slowing a clip lengthens it in place, so the clip after it has to be
    // moved first — the reducer will not silently overwrite it.
    const withNeighbour = mustExecute(
      clipState(),
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
    const result = executeCommand(
      withNeighbour,
      speedCmd(1, 2, { id: IDS.cmd7, baseVersion: 6 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OVERLAP");
  });

  it("undoes back to the exact previous clip", () => {
    const before = clipState();
    const result = executeCommand(before, speedCmd(2, 1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const undone = undo(result.state);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(canonicalStringify(undone.state.project)).toBe(
      canonicalStringify(before.project),
    );
  });

  it("replays byte-for-byte", () => {
    const result = executeCommand(clipState(), speedCmd(2, 1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const replayed = replay(result.state.operationLog);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(canonicalStringify(replayed.state.project)).toBe(
      canonicalStringify(result.state.project),
    );
  });

  it("is idempotent in effect when set to the rate already in force", () => {
    const result = executeCommand(clipState(), speedCmd(1, 1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(theClip(result.state)!.timelineDurationUs).toBe(
      theClip(clipState())!.timelineDurationUs,
    );
  });
});
