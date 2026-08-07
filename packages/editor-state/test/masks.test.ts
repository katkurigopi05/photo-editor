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
 * Mask commands.
 *
 * Masks are project state, so they arrive the same way every other change does:
 * validated commands with exact inverses, replayable byte-for-byte. The rules
 * that matter are the referential ones — an effect may not point at a mask that
 * does not exist, and a mask still in use may not be deleted out from under it.
 */

const USER = { type: "user", id: "user-1" } as const;

const RADIAL = {
  id: "contribution-1",
  kind: "radial" as const,
  mode: "add" as const,
  centre: { x: 0.5, y: 0.5 },
  radius: { x: 0.3, y: 0.3 },
  feather: 0.5,
  invert: false,
};

const LINEAR = {
  id: "contribution-2",
  kind: "linear" as const,
  mode: "subtract" as const,
  from: { x: 0, y: 0 },
  to: { x: 1, y: 1 },
};

function clipState(): EditorState {
  return mustExecute(
    baseTimelineState(),
    addClipCommand({ id: IDS.cmd5, createdAt: T.t5, baseVersion: 4 }),
  ).state;
}

const theClip = (state: EditorState) =>
  state.project?.sequences[0]?.tracks[0]?.clips[0];

const command = (
  commandType: string,
  payload: unknown,
  overrides: Partial<{ id: string; baseVersion: number }> = {},
): ProjectCommand =>
  ({
    id: overrides.id ?? IDS.cmd6,
    commandType,
    baseVersion: overrides.baseVersion ?? 5,
    actor: USER,
    createdAt: T.t6,
    payload,
  }) as ProjectCommand;

const addMask = (
  overrides: Partial<{ id: string; baseVersion: number; maskId: string }> = {},
): ProjectCommand =>
  command(
    "timeline.add_mask",
    {
      sequenceId: "sequence-1",
      clipId: "clip-1",
      mask: {
        id: overrides.maskId ?? "mask-1",
        name: "Subject",
        contributions: [RADIAL],
      },
    },
    overrides,
  );

/** A clip carrying one mask and one effect. */
function maskedState(): EditorState {
  const withMask = mustExecute(clipState(), addMask()).state;
  return mustExecute(
    withMask,
    command(
      "timeline.add_effect",
      {
        sequenceId: "sequence-1",
        clipId: "clip-1",
        effect: {
          id: "fx-1",
          type: "color.vibrance",
          enabled: true,
          params: { amount: 0.5 },
        },
      },
      { id: IDS.cmd7, baseVersion: 6 },
    ),
  ).state;
}

describe("add_mask", () => {
  it("puts a validated mask on the clip", () => {
    const result = executeCommand(clipState(), addMask());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const masks = theClip(result.state)?.masks;
    expect(masks).toHaveLength(1);
    expect(masks?.[0]?.name).toBe("Subject");
  });

  it("rejects a duplicate mask id", () => {
    const state = mustExecute(clipState(), addMask()).state;
    const result = executeCommand(
      state,
      addMask({ id: IDS.cmd7, baseVersion: 6 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DUPLICATE_ID");
  });

  it("rejects a mask with no contributions", () => {
    const result = executeCommand(
      clipState(),
      command("timeline.add_mask", {
        sequenceId: "sequence-1",
        clipId: "clip-1",
        mask: { id: "mask-1", contributions: [] },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("undoes back to a clip with no masks at all", () => {
    // Not "an empty array": the field is optional, and undo has to restore the
    // exact bytes, which means removing it.
    const before = clipState();
    const result = executeCommand(before, addMask());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const undone = undo(result.state);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(canonicalStringify(undone.state.project)).toBe(
      canonicalStringify(before.project),
    );
  });
});

describe("update_mask", () => {
  it("replaces the contribution stack", () => {
    const state = mustExecute(clipState(), addMask()).state;
    const result = executeCommand(
      state,
      command(
        "timeline.update_mask",
        {
          sequenceId: "sequence-1",
          clipId: "clip-1",
          maskId: "mask-1",
          contributions: [RADIAL, LINEAR],
        },
        { id: IDS.cmd7, baseVersion: 6 },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(theClip(result.state)?.masks?.[0]?.contributions).toHaveLength(2);
  });

  it("reports a missing mask", () => {
    const result = executeCommand(
      clipState(),
      command("timeline.update_mask", {
        sequenceId: "sequence-1",
        clipId: "clip-1",
        maskId: "nope",
        contributions: [RADIAL],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MASK_NOT_FOUND");
  });

  it("restores the previous stack on undo", () => {
    const state = mustExecute(clipState(), addMask()).state;
    const result = executeCommand(
      state,
      command(
        "timeline.update_mask",
        {
          sequenceId: "sequence-1",
          clipId: "clip-1",
          maskId: "mask-1",
          contributions: [LINEAR],
        },
        { id: IDS.cmd7, baseVersion: 6 },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const undone = undo(result.state);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(canonicalStringify(undone.state.project)).toBe(
      canonicalStringify(state.project),
    );
  });
});

describe("set_effect_mask", () => {
  it("points an effect at a mask", () => {
    const result = executeCommand(
      maskedState(),
      command(
        "timeline.set_effect_mask",
        {
          sequenceId: "sequence-1",
          clipId: "clip-1",
          effectId: "fx-1",
          maskId: "mask-1",
        },
        { id: IDS.cmd8, baseVersion: 7 },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(theClip(result.state)?.effects[0]?.maskId).toBe("mask-1");
  });

  it("clears the reference with a null mask id", () => {
    const pointed = mustExecute(
      maskedState(),
      command(
        "timeline.set_effect_mask",
        {
          sequenceId: "sequence-1",
          clipId: "clip-1",
          effectId: "fx-1",
          maskId: "mask-1",
        },
        { id: IDS.cmd8, baseVersion: 7 },
      ),
    ).state;
    const result = executeCommand(
      pointed,
      command(
        "timeline.set_effect_mask",
        {
          sequenceId: "sequence-1",
          clipId: "clip-1",
          effectId: "fx-1",
          maskId: null,
        },
        { id: IDS.cmd1, baseVersion: 8 },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(theClip(result.state)?.effects[0]).not.toHaveProperty("maskId");
  });

  it("refuses a mask that does not exist on the clip", () => {
    // The referential rule: a dangling maskId would render as "no mask" and
    // look like the adjustment simply stopped being local.
    const result = executeCommand(
      maskedState(),
      command(
        "timeline.set_effect_mask",
        {
          sequenceId: "sequence-1",
          clipId: "clip-1",
          effectId: "fx-1",
          maskId: "ghost",
        },
        { id: IDS.cmd8, baseVersion: 7 },
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MASK_NOT_FOUND");
  });
});

describe("remove_mask", () => {
  it("removes an unused mask", () => {
    const state = mustExecute(clipState(), addMask()).state;
    const result = executeCommand(
      state,
      command(
        "timeline.remove_mask",
        { sequenceId: "sequence-1", clipId: "clip-1", maskId: "mask-1" },
        { id: IDS.cmd7, baseVersion: 6 },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(theClip(result.state)).not.toHaveProperty("masks");
  });

  it("refuses to remove a mask an effect still references", () => {
    const pointed = mustExecute(
      maskedState(),
      command(
        "timeline.set_effect_mask",
        {
          sequenceId: "sequence-1",
          clipId: "clip-1",
          effectId: "fx-1",
          maskId: "mask-1",
        },
        { id: IDS.cmd8, baseVersion: 7 },
      ),
    ).state;
    const result = executeCommand(
      pointed,
      command(
        "timeline.remove_mask",
        { sequenceId: "sequence-1", clipId: "clip-1", maskId: "mask-1" },
        { id: IDS.cmd1, baseVersion: 8 },
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MASK_IN_USE");
  });

  it("restores the mask at its exact index on undo", () => {
    const two = mustExecute(
      mustExecute(clipState(), addMask()).state,
      addMask({ id: IDS.cmd7, baseVersion: 6, maskId: "mask-2" }),
    ).state;
    const result = executeCommand(
      two,
      command(
        "timeline.remove_mask",
        { sequenceId: "sequence-1", clipId: "clip-1", maskId: "mask-1" },
        { id: IDS.cmd8, baseVersion: 7 },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const undone = undo(result.state);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(canonicalStringify(undone.state.project)).toBe(
      canonicalStringify(two.project),
    );
  });
});

describe("replay", () => {
  it("reconstructs a masked project byte-for-byte", () => {
    const state = mustExecute(
      maskedState(),
      command(
        "timeline.set_effect_mask",
        {
          sequenceId: "sequence-1",
          clipId: "clip-1",
          effectId: "fx-1",
          maskId: "mask-1",
        },
        { id: IDS.cmd8, baseVersion: 7 },
      ),
    ).state;
    const replayed = replay(state.operationLog);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(canonicalStringify(replayed.state.project)).toBe(
      canonicalStringify(state.project),
    );
  });
});
