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

const USER = { type: "user", id: "user-1" } as const;

function clipState(): EditorState {
  return mustExecute(
    baseTimelineState(),
    addClipCommand({ id: IDS.cmd5, createdAt: T.t5, baseVersion: 4 }),
  ).state;
}

const brightness = (id: string, amount: number) => ({
  id,
  type: "color.brightness" as const,
  enabled: true,
  params: { amount },
});

const updateCmd = (effects: unknown[], baseVersion = 5): ProjectCommand =>
  ({
    id: IDS.cmd6,
    commandType: "timeline.update_clip_effects",
    baseVersion,
    actor: USER,
    createdAt: T.t6,
    payload: { sequenceId: "sequence-1", clipId: "clip-1", effects },
  }) as ProjectCommand;

describe("timeline.update_clip_effects", () => {
  it("replaces the whole effect stack; undo restores the prior stack", () => {
    const state = clipState();
    const before = canonicalStringify(
      state.project?.sequences[0]?.tracks[0]?.clips[0]?.effects,
    );
    const set = mustExecute(
      state,
      updateCmd([brightness("fx-a", 0.2), brightness("fx-b", -0.3)]),
    );
    const effects =
      set.state.project?.sequences[0]?.tracks[0]?.clips[0]?.effects;
    expect(effects?.map((e) => e.id)).toEqual(["fx-a", "fx-b"]);

    const undone = undo(set.state);
    expect(undone.ok).toBe(true);
    if (undone.ok) {
      expect(
        canonicalStringify(
          undone.state.project?.sequences[0]?.tracks[0]?.clips[0]?.effects,
        ),
      ).toBe(before);
    }
  });

  it("rejects duplicate effect ids", () => {
    const result = executeCommand(
      clipState(),
      updateCmd([brightness("dup", 0.1), brightness("dup", 0.2)]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DUPLICATE_ID");
  });

  it("rejects invalid effect params at the boundary", () => {
    const result = executeCommand(
      clipState(),
      updateCmd([brightness("fx-a", 99)]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});
