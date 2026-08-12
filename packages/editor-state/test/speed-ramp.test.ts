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
 * `timeline.set_clip_speed_ramp`.
 *
 * A clip whose rate changes partway through, in constant rational steps. The
 * duration is the sum of each segment's own stretch, so setting a ramp resizes
 * the clip exactly as `set_clip_speed` does — and refuses for the same two
 * reasons: a lengthening that would collide, and a shortening that would strand
 * a keyframe.
 *
 * The fixture's asset is five seconds long.
 */

const USER = { type: "user", id: "user-1" } as const;

const seg = (id: string, sourceOffsetUs: string, num: number, den: number) => ({
  id,
  sourceOffsetUs,
  rate: { numerator: num, denominator: den },
});

/** Full speed, quarter speed from 2s, full speed again from 3s. */
const RAMP = [
  seg("s1", "0", 1, 1),
  seg("s2", "2000000", 1, 4),
  seg("s3", "3000000", 1, 1),
];

/** One five-second clip on track-1, alone. Version 5. */
function oneClip(): EditorState {
  return mustExecute(
    baseTimelineState(),
    addClipCommand({
      id: IDS.cmd5,
      createdAt: T.t5,
      baseVersion: 4,
      clipId: "clip-a",
      timelineStartUs: "0",
      sourceInUs: "0",
      sourceOutUs: "5000000",
    }),
  ).state;
}

const clipA = (state: EditorState) =>
  state.project?.sequences[0]?.tracks[0]?.clips.find((c) => c.id === "clip-a");

const setRamp = (
  state: EditorState,
  ramp: unknown,
  id: string = IDS.cmd6,
  createdAt: string = T.t6,
  clipId = "clip-a",
): ReturnType<typeof executeCommand> =>
  executeCommand(state, {
    id,
    commandType: "timeline.set_clip_speed_ramp",
    baseVersion: state.project?.currentVersion ?? 0,
    actor: USER,
    createdAt,
    payload: { sequenceId: "sequence-1", clipId, ramp },
  } as ProjectCommand);

describe("timeline.set_clip_speed_ramp", () => {
  it("resizes the clip to the sum of its segments", () => {
    // 2s at 1x + 1s at quarter speed + 2s at 1x = 2 + 4 + 2 = 8s.
    const result = setRamp(oneClip(), RAMP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(clipA(result.state)?.timelineDurationUs).toBe("8000000");
    expect(clipA(result.state)?.speedRamp).toHaveLength(3);
  });

  it("leaves the source range alone", () => {
    // A ramp changes how the same frames are spread over the timeline, not
    // which frames are used — the rule `set_clip_speed` already keeps.
    const result = setRamp(oneClip(), RAMP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(clipA(result.state)?.sourceInUs).toBe("0");
    expect(clipA(result.state)?.sourceOutUs).toBe("5000000");
  });

  it("pins the constant rate to 1/1, so one behaviour has one spelling", () => {
    const halved = mustExecute(oneClip(), {
      id: IDS.cmd6,
      commandType: "timeline.set_clip_speed",
      baseVersion: 5,
      actor: USER,
      createdAt: T.t6,
      payload: {
        sequenceId: "sequence-1",
        clipId: "clip-a",
        playbackRate: { numerator: 1, denominator: 2 },
      },
    } as ProjectCommand).state;

    const result = setRamp(halved, RAMP, IDS.cmd7, T.t7);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The ramp is the whole description; a leftover 1/2 would silently double
    // every segment and there would be two ways to write one speed.
    expect(clipA(result.state)?.playbackRate).toEqual({
      numerator: 1,
      denominator: 1,
    });
    expect(clipA(result.state)?.timelineDurationUs).toBe("8000000");
  });

  it("clears the ramp, and the member with it", () => {
    const ramped = setRamp(oneClip(), RAMP);
    expect(ramped.ok).toBe(true);
    if (!ramped.ok) return;
    const cleared = setRamp(ramped.state, null, IDS.cmd7, T.t7);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    // Absent, not an empty array: canonical JSON treats those as different
    // projects, and "no ramp" is the state an untouched clip is in.
    expect(clipA(cleared.state)).not.toHaveProperty("speedRamp");
    expect(clipA(cleared.state)?.timelineDurationUs).toBe("5000000");
  });

  it("refuses a segment at or past the end of the source", () => {
    // A segment starting where the clip stops would describe no frames at all.
    const result = setRamp(oneClip(), [
      seg("s1", "0", 1, 1),
      seg("s2", "5000000", 1, 4),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OUT_OF_BOUNDS");
  });

  it("refuses a lengthening that would collide with the next clip", () => {
    const two = mustExecute(
      oneClip(),
      addClipCommand({
        id: IDS.cmd6,
        createdAt: T.t6,
        baseVersion: 5,
        clipId: "clip-b",
        timelineStartUs: "5000000",
        sourceInUs: "0",
        sourceOutUs: "1000000",
      }),
    ).state;
    const result = setRamp(two, RAMP, IDS.cmd7, T.t7);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OVERLAP");
  });

  it("refuses a shortening that would strand a keyframe", () => {
    // The rule trimming and constant retiming already enforce.
    const animated = mustExecute(oneClip(), {
      id: IDS.cmd6,
      commandType: "timeline.update_clip_animations",
      baseVersion: 5,
      actor: USER,
      createdAt: T.t6,
      payload: {
        sequenceId: "sequence-1",
        clipId: "clip-a",
        animations: [
          {
            id: "anim-1",
            property: "transform.opacity",
            keyframes: [
              { id: "k1", timeUs: "0", value: 0, easing: "linear" },
              { id: "k2", timeUs: "4500000", value: 1, easing: "linear" },
            ],
          },
        ],
      },
    } as ProjectCommand).state;

    // Every segment at 4x shrinks five seconds to one and a quarter.
    const result = setRamp(
      animated,
      [seg("s1", "0", 4, 1), seg("s2", "2000000", 4, 1)],
      IDS.cmd7,
      T.t7,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OUT_OF_BOUNDS");
  });

  it("refuses an unknown clip", () => {
    const result = setRamp(oneClip(), RAMP, IDS.cmd6, T.t6, "ghost");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CLIP_NOT_FOUND");
  });

  it("refuses a one-segment ramp at the schema boundary", () => {
    const result = setRamp(oneClip(), [seg("s1", "0", 1, 2)]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("undoes to the exact previous state", () => {
    const before = oneClip();
    const result = setRamp(before, RAMP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const undone = undo(result.state);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(canonicalStringify(undone.state.project)).toBe(
      canonicalStringify(before.project),
    );
  });

  it("undoes a ramp that replaced a constant speed, restoring both", () => {
    // The inverse has to carry the rate *and* the duration: the forward
    // division truncates, and recomputing on undo would repeat the truncation.
    const halved = mustExecute(oneClip(), {
      id: IDS.cmd6,
      commandType: "timeline.set_clip_speed",
      baseVersion: 5,
      actor: USER,
      createdAt: T.t6,
      payload: {
        sequenceId: "sequence-1",
        clipId: "clip-a",
        playbackRate: { numerator: 3, denominator: 7 },
      },
    } as ProjectCommand).state;

    const result = setRamp(halved, RAMP, IDS.cmd7, T.t7);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const undone = undo(result.state);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(canonicalStringify(undone.state.project)).toBe(
      canonicalStringify(halved.project),
    );
  });

  it("replays byte-for-byte", () => {
    const result = setRamp(oneClip(), RAMP);
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

describe("timeline.set_clip_speed on a ramped clip", () => {
  it("is refused rather than silently dropping the ramp", () => {
    // Two ways to describe one clip's speed must not both be live at once.
    // Clearing the ramp is a command of its own, and saying so is better than
    // discarding work the person cannot see they have lost.
    const ramped = setRamp(oneClip(), RAMP);
    expect(ramped.ok).toBe(true);
    if (!ramped.ok) return;

    const result = executeCommand(ramped.state, {
      id: IDS.cmd7,
      commandType: "timeline.set_clip_speed",
      baseVersion: 6,
      actor: USER,
      createdAt: T.t7,
      payload: {
        sequenceId: "sequence-1",
        clipId: "clip-a",
        playbackRate: { numerator: 2, denominator: 1 },
      },
    } as ProjectCommand);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});
