import { describe, expect, it } from "vitest";
import type { ProjectCommand } from "@director/command-schema";
import { executeCommand, undo, type EditorState } from "../src/index.js";
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

const addRemoveBg = (
  params: Record<string, unknown>,
  baseVersion = 5,
): ProjectCommand =>
  ({
    id: IDS.cmd6,
    commandType: "timeline.add_effect",
    baseVersion,
    actor: USER,
    createdAt: T.t6,
    payload: {
      sequenceId: "sequence-1",
      clipId: "clip-1",
      effect: {
        id: "fx-bg",
        type: "fx.remove_background",
        enabled: true,
        params,
      },
    },
  }) as ProjectCommand;

const validParams = {
  auto: true,
  keyColorHex: "#00ff00",
  threshold: 0.28,
  softness: 0.12,
};

describe("fx.remove_background effect", () => {
  it("adds a validated background-removal effect and undo removes it", () => {
    const set = mustExecute(clipState(), addRemoveBg(validParams));
    const fx = set.state.project?.sequences[0]?.tracks[0]?.clips[0]?.effects[0];
    expect(fx?.type).toBe("fx.remove_background");

    const undone = undo(set.state);
    expect(undone.ok).toBe(true);
    if (undone.ok) {
      expect(
        undone.state.project?.sequences[0]?.tracks[0]?.clips[0]?.effects,
      ).toHaveLength(0);
    }
  });

  it("rejects an out-of-range threshold", () => {
    const result = executeCommand(
      clipState(),
      addRemoveBg({ ...validParams, threshold: 2 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a bad key color", () => {
    const result = executeCommand(
      clipState(),
      addRemoveBg({ ...validParams, keyColorHex: "green" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});
