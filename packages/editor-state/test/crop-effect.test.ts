import { describe, expect, it } from "vitest";
import type { ProjectCommand } from "@director/command-schema";
import {
  executeCommand,
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
const EFFECT_ID = "10000000-0000-4000-8000-0000000000c1";

function clipState(): EditorState {
  return mustExecute(
    baseTimelineState(),
    addClipCommand({ id: IDS.cmd5, createdAt: T.t5, baseVersion: 4 }),
  ).state;
}

function addCropEffect(
  params: Record<string, unknown>,
  baseVersion = 5,
): ProjectCommand {
  return {
    id: IDS.cmd6,
    commandType: "timeline.add_effect",
    baseVersion,
    actor: USER,
    createdAt: T.t6,
    payload: {
      sequenceId: "sequence-1",
      clipId: "clip-1",
      effect: { id: EFFECT_ID, type: "transform.crop", enabled: true, params },
    },
  } as ProjectCommand;
}

function expectError(
  state: EditorState,
  input: unknown,
  code: CommandErrorCode,
): void {
  const result = executeCommand(state, input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

describe("transform.crop effect", () => {
  it("accepts a valid normalized crop rect", () => {
    const result = executeCommand(
      clipState(),
      addCropEffect({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const clip = result.state.project?.sequences[0]?.tracks[0]?.clips[0];
      expect(clip?.effects[0]?.type).toBe("transform.crop");
    }
  });

  it("rejects x + width exceeding 1", () => {
    expectError(
      clipState(),
      addCropEffect({ x: 0.7, y: 0, width: 0.5, height: 0.5 }),
      "VALIDATION_ERROR",
    );
  });

  it("rejects y + height exceeding 1", () => {
    expectError(
      clipState(),
      addCropEffect({ x: 0, y: 0.8, width: 0.3, height: 0.3 }),
      "VALIDATION_ERROR",
    );
  });

  it("rejects a zero-size crop", () => {
    expectError(
      clipState(),
      addCropEffect({ x: 0, y: 0, width: 0, height: 0.5 }),
      "VALIDATION_ERROR",
    );
  });

  it("rejects out-of-range fractions", () => {
    expectError(
      clipState(),
      addCropEffect({ x: -0.1, y: 0, width: 0.5, height: 0.5 }),
      "VALIDATION_ERROR",
    );
  });

  it("full-frame crop (no-op reframe) is valid, and undo removes it", () => {
    const added = mustExecute(
      clipState(),
      addCropEffect({ x: 0, y: 0, width: 1, height: 1 }),
    );
    const clip = added.state.project?.sequences[0]?.tracks[0]?.clips[0];
    expect(clip?.effects).toHaveLength(1);

    const undone = undo(added.state);
    expect(undone.ok).toBe(true);
    if (undone.ok) {
      const restored = undone.state.project?.sequences[0]?.tracks[0]?.clips[0];
      expect(restored?.effects).toHaveLength(0);
    }
  });
});
