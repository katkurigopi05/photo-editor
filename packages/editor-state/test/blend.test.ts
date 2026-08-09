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
 * The blend-mode command.
 *
 * One rule carries the whole feature: "normal" is the *absence* of a mode, not
 * a value. Storing it would make a clip set back to normal and a clip never
 * touched two different projects that render identically — which is exactly
 * what canonical state exists to prevent, and what would break a byte-for-byte
 * undo.
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

const setBlend = (
  blendMode: string,
  overrides: Partial<{ id: string; baseVersion: number }> = {},
): ProjectCommand =>
  ({
    id: overrides.id ?? IDS.cmd6,
    commandType: "timeline.set_clip_blend_mode",
    baseVersion: overrides.baseVersion ?? 5,
    actor: USER,
    createdAt: T.t6,
    payload: { sequenceId: "sequence-1", clipId: "clip-1", blendMode },
  }) as ProjectCommand;

describe("set_clip_blend_mode", () => {
  it("sets the mode on the clip", () => {
    const result = executeCommand(clipState(), setBlend("multiply"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(theClip(result.state)?.blendMode).toBe("multiply");
  });

  it("stores nothing at all for normal", () => {
    const state = mustExecute(clipState(), setBlend("screen")).state;
    const back = executeCommand(
      state,
      setBlend("normal", { id: IDS.cmd7, baseVersion: 6 }),
    );
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(theClip(back.state)).not.toHaveProperty("blendMode");
  });

  it("returns a clip to exactly its previous bytes on undo", () => {
    const before = clipState();
    const result = executeCommand(before, setBlend("overlay"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const undone = undo(result.state);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    // Not merely "back to normal" — back to a clip with no member, which is a
    // different project from one carrying blendMode: "normal".
    expect(canonicalStringify(undone.state.project)).toBe(
      canonicalStringify(before.project),
    );
  });

  it("restores the previous mode, not the default, on undo", () => {
    const screened = mustExecute(clipState(), setBlend("screen")).state;
    const changed = mustExecute(
      screened,
      setBlend("difference", { id: IDS.cmd7, baseVersion: 6 }),
    ).state;
    const undone = undo(changed);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(theClip(undone.state)?.blendMode).toBe("screen");
  });

  it("refuses an unknown mode", () => {
    expect(executeCommand(clipState(), setBlend("vivid-light")).ok).toBe(false);
  });

  it("reports a missing clip", () => {
    const command = {
      ...setBlend("multiply"),
      payload: {
        sequenceId: "sequence-1",
        clipId: "ghost",
        blendMode: "multiply",
      },
    } as ProjectCommand;
    const result = executeCommand(clipState(), command);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CLIP_NOT_FOUND");
  });

  it("replays byte-for-byte", () => {
    const state = mustExecute(
      mustExecute(clipState(), setBlend("multiply")).state,
      setBlend("soft-light", { id: IDS.cmd7, baseVersion: 6 }),
    ).state;
    const replayed = replay(state.operationLog);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(canonicalStringify(replayed.state.project)).toBe(
      canonicalStringify(state.project),
    );
  });
});
